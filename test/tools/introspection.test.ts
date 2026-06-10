import { describe, expect, it } from "vitest";

import { tools } from "../../src/tools/index.js";
import {
  explainTool,
  helpTool,
  toolCatalogTool,
} from "../../src/tools/introspection.js";

describe("infomaniak_help", () => {
  it("returns suggestions matching the intent", async () => {
    const result = (await helpTool.handler({
      intent: "create site",
      limit: 3,
    })) as {
      suggestions: Array<{ tool: string; score: number }>;
    };
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0]?.tool).toMatch(/create_site|sites?/);
  });

  it("returns no suggestions for a totally unrelated intent", async () => {
    const result = (await helpTool.handler({
      intent: "zzzz nonsense xyzzz",
      limit: 5,
    })) as { suggestions: ReadonlyArray<unknown> };
    expect(result.suggestions).toHaveLength(0);
  });

  it("respects the limit parameter", async () => {
    const result = (await helpTool.handler({ intent: "list", limit: 2 })) as {
      suggestions: ReadonlyArray<unknown>;
    };
    expect(result.suggestions.length).toBeLessThanOrEqual(2);
  });

  it("includes capability metadata for each suggestion", async () => {
    const result = (await helpTool.handler({
      intent: "mailbox security sender block",
      limit: 5,
    })) as {
      suggestions: Array<{
        tool: string;
        capability: {
          scope: string;
          risk: string;
          confirmation_required: boolean;
        };
      }>;
    };

    const blockSender = result.suggestions.find(
      (suggestion) => suggestion.tool === "infomaniak_block_sender",
    );
    expect(blockSender?.capability).toEqual({
      scope: "admin",
      risk: "write",
      confirmation_required: true,
    });
  });

  it("suggests the new mail admin tools for webmail, devices, signatures, and newsletters", async () => {
    const result = (await helpTool.handler({
      intent:
        "manage webmail access signatures newsletter subscribers and device cleanup",
      limit: 10,
    })) as {
      suggestions: Array<{ tool: string }>;
    };

    expect(result.suggestions.map((suggestion) => suggestion.tool)).toEqual(
      expect.arrayContaining([
        "infomaniak_manage_mail_webmail_access",
        "infomaniak_manage_mail_device_access",
        "infomaniak_manage_mail_signatures",
        "infomaniak_manage_newsletter_admin",
      ]),
    );
  });

  it("suggests kChat governance tools for admin channel and permission work", async () => {
    const result = (await helpTool.handler({
      intent: "update delete kchat channels members bots commands and roles",
      limit: 20,
    })) as {
      suggestions: Array<{ tool: string }>;
    };

    expect(result.suggestions.map((suggestion) => suggestion.tool)).toEqual(
      expect.arrayContaining([
        "infomaniak_list_kchat_channels",
        "infomaniak_manage_kchat_channel",
        "infomaniak_manage_kchat_channel_members",
        "infomaniak_manage_kchat_bot",
        "infomaniak_manage_kchat_command",
      ]),
    );
  });
});

describe("infomaniak_explain", () => {
  it("returns the full definition of a known tool", async () => {
    const result = (await explainTool.handler({
      tool: "infomaniak_overview",
    })) as {
      tool: string;
      description: string;
      input_schema: Record<string, unknown>;
      capability: {
        scope: string;
        risk: string;
        confirmation_required: boolean;
      };
    };
    expect(result.tool).toBe("infomaniak_overview");
    expect(result.description.length).toBeGreaterThan(10);
    expect(typeof result.input_schema).toBe("object");
    expect(result.capability).toEqual({
      scope: "admin",
      risk: "read",
      confirmation_required: false,
    });
  });

  it("throws a helpful error for unknown tools", async () => {
    await expect(
      explainTool.handler({ tool: "infomaniak_does_not_exist" }),
    ).rejects.toThrow(/Unknown tool/i);
  });

  it("can explain every registered tool", async () => {
    for (const tool of tools) {
      const explained = (await explainTool.handler({ tool: tool.name })) as {
        tool: string;
      };
      expect(explained.tool).toBe(tool.name);
    }
  });
});

describe("infomaniak_tool_catalog", () => {
  it("lists MCP tools by admin category with capability metadata and use cases", async () => {
    const result = (await toolCatalogTool.handler({
      category: "mail_security",
    })) as {
      tool_count: number;
      categories: Array<{
        category: string;
        tools: Array<{
          name: string;
          capability: {
            scope: string;
            risk: string;
            confirmation_required: boolean;
          };
        }>;
      }>;
      high_value_use_cases: Array<{
        title: string;
        tools: string[];
        prompt: string;
      }>;
      summary_markdown: string;
    };

    expect(result.tool_count).toBeGreaterThan(0);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]?.category).toBe("mail_security");
    expect(result.categories[0]?.tools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_block_sender",
        capability: {
          scope: "admin",
          risk: "write",
          confirmation_required: true,
        },
      }),
    );
    expect(result.categories[0]?.tools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_update_mailbox_folders",
        capability: expect.objectContaining({
          scope: "admin",
          risk: "write",
          confirmation_required: true,
        }),
      }),
    );
    expect(result.categories[0]?.tools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_purge_spam_folder",
        capability: expect.objectContaining({
          scope: "admin",
          risk: "destructive",
          confirmation_required: true,
        }),
      }),
    );
    expect(result.high_value_use_cases).toContainEqual(
      expect.objectContaining({
        title: "Block spam senders",
        tools: expect.arrayContaining(["infomaniak_block_sender"]),
      }),
    );
    expect(result.summary_markdown).toContain("infomaniak_block_sender");
  });

  it("filters the catalog by risk and includes audit-log tools", async () => {
    const result = (await toolCatalogTool.handler({
      risk: "read",
      limit: 200,
    })) as {
      categories: Array<{
        tools: Array<{ name: string; capability: { risk: string } }>;
      }>;
    };

    const catalogTools = result.categories.flatMap(
      (category) => category.tools,
    );
    expect(catalogTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_audit_log_tail",
        capability: expect.objectContaining({ risk: "read" }),
      }),
    );
    expect(catalogTools.every((tool) => tool.capability.risk === "read")).toBe(
      true,
    );
  });

  it("includes kDrive user administration tools and use cases", async () => {
    const result = (await toolCatalogTool.handler({ category: "kdrive" })) as {
      categories: Array<{
        category: string;
        tools: Array<{
          name: string;
          capability: {
            scope: string;
            risk: string;
            confirmation_required: boolean;
          };
        }>;
      }>;
      high_value_use_cases: Array<{ title: string; tools: string[] }>;
    };

    const kdriveTools = result.categories[0]?.tools ?? [];
    expect(kdriveTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_create_drive_user",
        capability: {
          scope: "admin",
          risk: "write",
          confirmation_required: true,
        },
      }),
    );
    expect(kdriveTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_update_drive_share_link",
        capability: {
          scope: "admin",
          risk: "write",
          confirmation_required: true,
        },
      }),
    );
    expect(kdriveTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_get_drive_statistics",
        capability: {
          scope: "admin",
          risk: "read",
          confirmation_required: false,
        },
      }),
    );
    expect(kdriveTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_list_drive_file_access_users",
        capability: {
          scope: "admin",
          risk: "read",
          confirmation_required: false,
        },
      }),
    );
    expect(kdriveTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_create_drive_file_access_user",
        capability: {
          scope: "admin",
          risk: "write",
          confirmation_required: true,
        },
      }),
    );
    expect(kdriveTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_create_drive_file_access_invitation",
        capability: {
          scope: "admin",
          risk: "write",
          confirmation_required: true,
        },
      }),
    );
    expect(kdriveTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_get_drive_settings",
        capability: {
          scope: "admin",
          risk: "read",
          confirmation_required: false,
        },
      }),
    );
    expect(kdriveTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_manage_drive_settings",
        capability: {
          scope: "admin",
          risk: "write",
          confirmation_required: true,
        },
      }),
    );
    expect(kdriveTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_remove_drive_share_link",
        capability: {
          scope: "admin",
          risk: "destructive",
          confirmation_required: true,
        },
      }),
    );
    expect(kdriveTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_delete_drive_user",
        capability: {
          scope: "admin",
          risk: "destructive",
          confirmation_required: true,
        },
      }),
    );
    expect(result.high_value_use_cases).toContainEqual(
      expect.objectContaining({
        title: "Manage kDrive users safely",
        tools: expect.arrayContaining(["infomaniak_lock_drive_user"]),
      }),
    );
    expect(result.high_value_use_cases).toContainEqual(
      expect.objectContaining({
        title: "Manage kDrive file permissions safely",
        tools: expect.arrayContaining([
          "infomaniak_create_drive_file_access_user",
        ]),
      }),
    );
    expect(result.high_value_use_cases).toContainEqual(
      expect.objectContaining({
        title: "Clean up risky kDrive share links",
        tools: expect.arrayContaining(["infomaniak_remove_drive_share_link"]),
      }),
    );
    expect(result.high_value_use_cases).toContainEqual(
      expect.objectContaining({
        title: "Review kDrive activity",
        tools: expect.arrayContaining(["infomaniak_get_drive_statistics"]),
      }),
    );
    expect(result.high_value_use_cases).toContainEqual(
      expect.objectContaining({
        title: "Tune kDrive settings",
        tools: expect.arrayContaining(["infomaniak_manage_drive_settings"]),
      }),
    );
  });

  it("includes account governance tools and use cases", async () => {
    const result = (await toolCatalogTool.handler({
      category: "account_access",
    })) as {
      categories: Array<{
        category: string;
        tools: Array<{
          name: string;
          capability: {
            scope: string;
            risk: string;
            confirmation_required: boolean;
          };
        }>;
      }>;
      high_value_use_cases: Array<{ title: string; tools: string[] }>;
    };

    const accountTools = result.categories[0]?.tools ?? [];
    expect(accountTools).toContainEqual(
      expect.objectContaining({ name: "infomaniak_create_account_invitation" }),
    );
    expect(accountTools).toContainEqual(
      expect.objectContaining({ name: "infomaniak_create_account_team" }),
    );
    expect(accountTools).toContainEqual(
      expect.objectContaining({ name: "infomaniak_create_account_tag" }),
    );
    expect(result.high_value_use_cases).toContainEqual(
      expect.objectContaining({
        title: "Manage account invitations and teams",
        tools: expect.arrayContaining(["infomaniak_add_account_team_users"]),
      }),
    );
    expect(result.high_value_use_cases).toContainEqual(
      expect.objectContaining({
        title: "Grant product access through an invitation",
        tools: expect.arrayContaining([
          "infomaniak_manage_account_invitation_access",
        ]),
      }),
    );
  });

  it("includes deeper mail admin tools and use cases", async () => {
    const result = (await toolCatalogTool.handler({ category: "mail" })) as {
      categories: Array<{
        category: string;
        tools: Array<{
          name: string;
          capability: {
            scope: string;
            risk: string;
            confirmation_required: boolean;
          };
        }>;
      }>;
      high_value_use_cases: Array<{ title: string; tools: string[] }>;
    };

    const mailTools = result.categories[0]?.tools ?? [];
    expect(mailTools).toContainEqual(
      expect.objectContaining({ name: "infomaniak_manage_mailbox_forwarding" }),
    );
    expect(mailTools).toContainEqual(
      expect.objectContaining({ name: "infomaniak_manage_mailbox_auto_reply" }),
    );
    expect(mailTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_manage_service_redirections",
      }),
    );
    expect(mailTools).toContainEqual(
      expect.objectContaining({ name: "infomaniak_rotate_mail_dkim" }),
    );
    expect(result.high_value_use_cases).toContainEqual(
      expect.objectContaining({
        title: "Adjust mailbox forwarding and auto-replies",
        tools: expect.arrayContaining(["infomaniak_manage_mailbox_forwarding"]),
      }),
    );
  });

  it("includes the expanded mail admin tools and use cases", async () => {
    const result = (await toolCatalogTool.handler({ category: "mail" })) as {
      categories: Array<{
        category: string;
        tools: Array<{
          name: string;
          capability: {
            scope: string;
            risk: string;
            confirmation_required: boolean;
          };
        }>;
      }>;
      high_value_use_cases: Array<{ title: string; tools: string[] }>;
    };

    const mailTools = result.categories[0]?.tools ?? [];
    expect(mailTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_get_mail_signatures",
        capability: expect.objectContaining({ scope: "admin", risk: "read" }),
      }),
    );
    expect(mailTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_manage_mail_webmail_access",
        capability: expect.objectContaining({
          risk: "destructive",
          confirmation_required: true,
        }),
      }),
    );
    expect(mailTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_manage_mail_device_access",
        capability: expect.objectContaining({
          risk: "destructive",
          confirmation_required: true,
        }),
      }),
    );
    expect(mailTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_manage_newsletter_admin",
        capability: expect.objectContaining({
          risk: "destructive",
          confirmation_required: true,
        }),
      }),
    );
    expect(result.high_value_use_cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Manage mail signatures and templates",
        }),
        expect.objectContaining({ title: "Review webmail access" }),
        expect.objectContaining({ title: "Clean up mail device sessions" }),
        expect.objectContaining({
          title: "Manage newsletter groups and subscribers",
        }),
      ]),
    );
  });

  it("includes kChat governance tools and use cases", async () => {
    const result = (await toolCatalogTool.handler({ category: "kchat" })) as {
      categories: Array<{
        category: string;
        tools: Array<{
          name: string;
          capability: {
            scope: string;
            risk: string;
            confirmation_required: boolean;
          };
        }>;
      }>;
      high_value_use_cases: Array<{ title: string; tools: string[] }>;
    };

    const kchatTools = result.categories[0]?.tools ?? [];
    expect(kchatTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_manage_kchat_channel",
        capability: {
          scope: "admin",
          risk: "destructive",
          confirmation_required: true,
        },
      }),
    );
    expect(kchatTools).toContainEqual(
      expect.objectContaining({
        name: "infomaniak_list_kchat_groups",
        capability: {
          scope: "admin",
          risk: "read",
          confirmation_required: false,
        },
      }),
    );
    expect(result.high_value_use_cases).toContainEqual(
      expect.objectContaining({
        title: "Govern kChat channels",
        tools: expect.arrayContaining(["infomaniak_manage_kchat_command"]),
      }),
    );
  });
});
