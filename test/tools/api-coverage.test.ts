import { afterEach, describe, expect, it, vi } from "vitest";

import { apiCoverageReportTool } from "../../src/tools/api-coverage.js";

function docsHtml(navigation: unknown): string {
  const payload = JSON.stringify({
    component: "Api",
    props: {
      navigation,
    },
  }).replaceAll('"', "&quot;");
  return `<html><body><div id="app" data-page="${payload}"></div></body></html>`;
}

describe("infomaniak_api_coverage_report", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses the developer portal navigation and classifies admin versus user endpoints", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        docsHtml({
          "Core Resources": {
            label: "Core Resources",
            items: [
              {
                summary: "List products",
                method: "get",
                endpoint: "/1/products",
              },
            ],
            sub_categories: {
              "User Management": {
                label: "User Management",
                items: [
                  {
                    summary: "Cancel an Invitation",
                    method: "delete",
                    endpoint: "/1/accounts/{account}/invitations/{invitation}",
                  },
                  {
                    summary: "List services",
                    method: "get",
                    endpoint: "/1/accounts/{account_id}/services",
                  },
                ],
              },
            },
          },
          Drive: {
            label: "Drive",
            items: [
              {
                summary: "Get users",
                method: "get",
                endpoint: "/2/drive/{drive_id}/users",
              },
              {
                summary: "Get share-link files",
                method: "get",
                endpoint: "/3/drive/{drive_id}/files/links",
              },
              {
                summary: "Get share-link",
                method: "get",
                endpoint: "/2/drive/{drive_id}/files/{file_id}/link",
              },
              {
                summary: "Create share-link",
                method: "post",
                endpoint: "/2/drive/{drive_id}/files/{file_id}/link",
              },
              {
                summary: "Update share-link",
                method: "put",
                endpoint: "/2/drive/{drive_id}/files/{file_id}/link",
              },
              {
                summary: "Remove share-link",
                method: "delete",
                endpoint: "/2/drive/{drive_id}/files/{file_id}/link",
              },
              {
                summary: "Share link invite",
                method: "post",
                endpoint: "/2/drive/{drive_id}/files/{file_id}/link/invite",
              },
              {
                summary: "List file access users",
                method: "get",
                endpoint: "/2/drive/{drive_id}/files/{file_id}/access/users",
              },
              {
                summary: "List file access teams",
                method: "get",
                endpoint: "/2/drive/{drive_id}/files/{file_id}/access/teams",
              },
              {
                summary: "List file access invitations",
                method: "get",
                endpoint:
                  "/2/drive/{drive_id}/files/{file_id}/access/invitations",
              },
              {
                summary: "Create file access user",
                method: "post",
                endpoint: "/2/drive/{drive_id}/files/{file_id}/access/users",
              },
              {
                summary: "Update file access user",
                method: "put",
                endpoint:
                  "/2/drive/{drive_id}/files/{file_id}/access/users/{user_id}",
              },
              {
                summary: "Remove file access user",
                method: "delete",
                endpoint:
                  "/2/drive/{drive_id}/files/{file_id}/access/users/{user_id}",
              },
              {
                summary: "Create file access team",
                method: "post",
                endpoint: "/2/drive/{drive_id}/files/{file_id}/access/teams",
              },
              {
                summary: "Update file access team",
                method: "put",
                endpoint:
                  "/2/drive/{drive_id}/files/{file_id}/access/teams/{team_id}",
              },
              {
                summary: "Remove file access team",
                method: "delete",
                endpoint:
                  "/2/drive/{drive_id}/files/{file_id}/access/teams/{team_id}",
              },
              {
                summary: "Invite file access",
                method: "post",
                endpoint:
                  "/2/drive/{drive_id}/files/{file_id}/access/invitations",
              },
              {
                summary: "Chart : files size",
                method: "get",
                endpoint: "/2/drive/{drive_id}/statistics/sizes",
              },
              {
                summary: "Export : files size",
                method: "get",
                endpoint: "/2/drive/{drive_id}/statistics/sizes/export",
              },
              {
                summary: "Activities : Users",
                method: "get",
                endpoint: "/2/drive/{drive_id}/statistics/activities/users",
              },
              {
                summary: "Activities : Shared files",
                method: "get",
                endpoint:
                  "/2/drive/{drive_id}/statistics/activities/shared_files",
              },
              {
                summary: "Chart : Activities",
                method: "get",
                endpoint: "/2/drive/{drive_id}/statistics/activities",
              },
              {
                summary: "Export : Activities",
                method: "get",
                endpoint: "/2/drive/{drive_id}/statistics/activities/export",
              },
              {
                summary: "Activities : ShareLinks",
                method: "get",
                endpoint: "/2/drive/{drive_id}/statistics/activities/links",
              },
              {
                summary: "Export : ShareLinks Activities",
                method: "get",
                endpoint:
                  "/2/drive/{drive_id}/statistics/activities/links/export",
              },
              {
                summary: "Create user",
                method: "post",
                endpoint: "/2/drive/{drive_id}/users",
              },
              {
                summary: "Update user",
                method: "put",
                endpoint: "/2/drive/{drive_id}/users/{user_id}",
              },
              {
                summary: "Delete user",
                method: "delete",
                endpoint: "/2/drive/{drive_id}/users/{user_id}",
              },
              {
                summary: "Update user manager right",
                method: "patch",
                endpoint: "/2/drive/{drive_id}/users/{user_id}/manager",
              },
              {
                summary: "Lock user",
                method: "post",
                endpoint: "/2/drive/{drive_id}/users/{user_id}/lock",
              },
              {
                summary: "Unlock user",
                method: "post",
                endpoint: "/2/drive/{drive_id}/users/{user_id}/unlock",
              },
              {
                summary: "Update trash settings",
                method: "put",
                endpoint: "/2/drive/{drive_id}/settings/trash",
              },
              {
                summary: "Get drive settings",
                method: "get",
                endpoint: "/2/drive/{drive_id}/settings",
              },
              {
                summary: "Update AI settings",
                method: "put",
                endpoint: "/2/drive/{drive_id}/settings/ai",
              },
              {
                summary: "Update link settings",
                method: "put",
                endpoint: "/2/drive/{drive_id}/settings/link",
              },
              {
                summary: "Update office settings",
                method: "put",
                endpoint: "/2/drive/{drive_id}/settings/office",
              },
              {
                summary: "Update preferences",
                method: "put",
                endpoint: "/2/drive/{drive_id}/preferences",
              },
              {
                summary: "Empty trash",
                method: "delete",
                endpoint: "/2/drive/{drive_id}/trash",
              },
              {
                summary: "Remove file",
                method: "delete",
                endpoint: "/2/drive/{drive_id}/trash/{file_id}",
              },
              {
                summary: "Restore file",
                method: "post",
                endpoint: "/2/drive/{drive_id}/trash/{file_id}/restore",
              },
            ],
          },
          "Mail Services": {
            label: "Mail Services",
            sub_categories: {
              "Mailboxes > Folders": {
                label: "Mailboxes > Folders",
                items: [
                  {
                    summary: "Update folders",
                    method: "put",
                    endpoint:
                      "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/folders",
                  },
                  {
                    summary: "Purge spam folder",
                    method: "delete",
                    endpoint:
                      "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/folders/spam",
                  },
                ],
              },
            },
          },
          kMeet: {
            label: "kMeet",
            items: [
              {
                summary: "Plan a conference",
                method: "post",
                endpoint: "/1/kmeet/rooms",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }) as typeof fetch;

    const result = (await apiCoverageReportTool.handler({ limit: 30 })) as {
      total_endpoints: number;
      summary: Record<string, number>;
      covered_examples: Array<{
        endpoint: string;
        classification: string;
        covered_by: string[];
      }>;
      candidates: Array<{
        endpoint: string;
        classification: string;
        covered_by: string[];
      }>;
      out_of_scope_examples: Array<{
        endpoint: string;
        classification: string;
      }>;
    };

    expect(result.total_endpoints).toBe(46);
    expect(result.summary["covered"]).toBeGreaterThanOrEqual(14);
    expect(result.summary["admin_candidate"]).toBeGreaterThanOrEqual(1);
    expect(result.summary["dangerous_write"]).toBeGreaterThanOrEqual(1);
    expect(result.out_of_scope_examples).toContainEqual(
      expect.objectContaining({
        endpoint: "/1/kmeet/rooms",
        classification: "end_user_out_of_scope",
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/1/accounts/{account}/invitations/{invitation}",
        classification: "dangerous_write",
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint:
          "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/folders",
        classification: "dangerous_write",
        covered_by: ["infomaniak_update_mailbox_folders"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint:
          "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/folders/spam",
        classification: "dangerous_write",
        covered_by: ["infomaniak_purge_spam_folder"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/trash",
        classification: "dangerous_write",
        covered_by: ["infomaniak_empty_drive_trash"],
      }),
    );
    expect(result.covered_examples).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/settings",
        classification: "covered",
        covered_by: expect.arrayContaining(["infomaniak_get_drive_settings"]),
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/settings/ai",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_drive_settings"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/settings/link",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_drive_settings"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/settings/office",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_drive_settings"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/preferences",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_drive_settings"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/files/{file_id}/link",
        classification: "dangerous_write",
        covered_by: ["infomaniak_create_drive_share_link"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/files/{file_id}/link",
        classification: "dangerous_write",
        covered_by: ["infomaniak_remove_drive_share_link"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/files/{file_id}/link/invite",
        classification: "dangerous_write",
        covered_by: ["infomaniak_invite_drive_share_link"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/files/{file_id}/access/users",
        classification: "dangerous_write",
        covered_by: ["infomaniak_create_drive_file_access_user"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/files/{file_id}/access/users/{user_id}",
        classification: "dangerous_write",
        covered_by: ["infomaniak_update_drive_file_access_user"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/files/{file_id}/access/users/{user_id}",
        classification: "dangerous_write",
        covered_by: ["infomaniak_remove_drive_file_access_user"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/files/{file_id}/access/teams",
        classification: "dangerous_write",
        covered_by: ["infomaniak_create_drive_file_access_team"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/files/{file_id}/access/teams/{team_id}",
        classification: "dangerous_write",
        covered_by: ["infomaniak_update_drive_file_access_team"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/files/{file_id}/access/teams/{team_id}",
        classification: "dangerous_write",
        covered_by: ["infomaniak_remove_drive_file_access_team"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/files/{file_id}/access/invitations",
        classification: "dangerous_write",
        covered_by: ["infomaniak_create_drive_file_access_invitation"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/users",
        classification: "dangerous_write",
        covered_by: ["infomaniak_create_drive_user"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/users/{user_id}",
        classification: "dangerous_write",
        covered_by: ["infomaniak_delete_drive_user"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/users/{user_id}/manager",
        classification: "dangerous_write",
        covered_by: ["infomaniak_set_drive_user_manager"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/users/{user_id}/lock",
        classification: "dangerous_write",
        covered_by: ["infomaniak_lock_drive_user"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/2/drive/{drive_id}/trash/{file_id}/restore",
        classification: "dangerous_write",
        covered_by: ["infomaniak_restore_drive_trash_item"],
      }),
    );
  });

  it("covers the new account governance and deeper mail admin endpoints", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        docsHtml({
          "Core Resources": {
            label: "Core Resources",
            sub_categories: {
              "User Management": {
                label: "User Management",
                sub_categories: {
                  Accounts: {
                    label: "Accounts",
                    items: [
                      {
                        summary: "Invite a User",
                        method: "post",
                        endpoint: "/1/accounts/{account}/invitations",
                      },
                      {
                        summary: "Get invitation access",
                        method: "get",
                        endpoint:
                          "/1/accounts/{account}/invitations/{invitation}",
                      },
                      {
                        summary: "Grant kSuite access",
                        method: "post",
                        endpoint:
                          "/1/accounts/{account}/invitations/{invitation}/ksuite",
                      },
                      {
                        summary: "Update drive access",
                        method: "patch",
                        endpoint:
                          "/1/accounts/{account}/invitations/{invitation}/drive/{drive_id}",
                      },
                      {
                        summary: "Grant drive access",
                        method: "post",
                        endpoint:
                          "/1/accounts/{account}/invitations/{invitation}/drive",
                      },
                      {
                        summary: "Update mailbox access",
                        method: "patch",
                        endpoint:
                          "/1/accounts/{account}/invitations/{invitation}/mailbox/{mail_id}",
                      },
                      {
                        summary: "Invite mailbox access",
                        method: "post",
                        endpoint:
                          "/1/accounts/{account}/invitations/{invitation}/mailbox/invite",
                      },
                      {
                        summary: "Update kChat access",
                        method: "patch",
                        endpoint:
                          "/1/accounts/{account}/invitations/{invitation}/kchat",
                      },
                      {
                        summary: "Create a Team",
                        method: "post",
                        endpoint: "/1/accounts/{account}/teams",
                      },
                      {
                        summary: "Create a tag",
                        method: "post",
                        endpoint: "/1/accounts/{account}/tags",
                      },
                    ],
                  },
                },
              },
            },
          },
          "Mail Services": {
            label: "Mail Services",
            sub_categories: {
              "Mailbox management": {
                label: "Mailbox management",
                items: [
                  {
                    summary: "List aliases",
                    method: "get",
                    endpoint:
                      "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/aliases",
                  },
                  {
                    summary: "Update aliases",
                    method: "put",
                    endpoint:
                      "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/aliases",
                  },
                  {
                    summary: "List forwarding",
                    method: "get",
                    endpoint:
                      "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/forwarding_addresses",
                  },
                  {
                    summary: "Update a forwarding",
                    method: "put",
                    endpoint:
                      "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/forwarding_addresses",
                  },
                  {
                    summary: "List auto replies models",
                    method: "get",
                    endpoint:
                      "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auto_reply/model",
                  },
                ],
              },
              Signatures: {
                label: "Signatures",
                items: [
                  {
                    summary: "List all Signatures",
                    method: "get",
                    endpoint:
                      "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures",
                  },
                  {
                    summary: "Delete a signature",
                    method: "delete",
                    endpoint:
                      "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures/{signature}",
                  },
                ],
              },
              Accesses: {
                label: "Accesses",
                sub_categories: {
                  Webmail: {
                    label: "Webmail",
                    items: [
                      {
                        summary: "List access and invitations",
                        method: "get",
                        endpoint:
                          "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/webmail",
                      },
                      {
                        summary: "Update webmail access",
                        method: "patch",
                        endpoint:
                          "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/webmail/users/{user_id}",
                      },
                    ],
                  },
                  Devices: {
                    label: "Devices",
                    items: [
                      {
                        summary: "List device access for a user",
                        method: "get",
                        endpoint:
                          "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/devices/users/{user_id}",
                      },
                      {
                        summary: "Delete device access",
                        method: "delete",
                        endpoint:
                          "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/devices/{device_access}",
                      },
                    ],
                  },
                },
              },
              Redirections: {
                label: "Redirections",
                items: [
                  {
                    summary: "Send confirmation request",
                    method: "put",
                    endpoint:
                      "/1/mail_hostings/{mail_hosting_id}/redirections/{redirection_id}/send-confirmation-requests",
                  },
                ],
              },
              Diagnostic: {
                label: "Diagnostic",
                sub_categories: {
                  Dkim: {
                    label: "Dkim",
                    items: [
                      {
                        summary: "Rotate Dkim",
                        method: "post",
                        endpoint:
                          "/1/mail_hostings/{mail_hosting_id}/diagnostic/dkim/rotate",
                      },
                    ],
                  },
                },
              },
            },
          },
          Newsletter: {
            label: "Newsletter",
            sub_categories: {
              Groups: {
                label: "Groups",
                items: [
                  {
                    summary: "List all groups",
                    method: "get",
                    endpoint: "/1/newsletters/{domain}/groups",
                  },
                  {
                    summary: "Create a group",
                    method: "post",
                    endpoint: "/1/newsletters/{domain}/groups",
                  },
                ],
              },
              Subscribers: {
                label: "Subscribers",
                items: [
                  {
                    summary: "List all subscribers",
                    method: "get",
                    endpoint: "/1/newsletters/{domain}/subscribers",
                  },
                  {
                    summary: "Create a subscriber",
                    method: "post",
                    endpoint: "/1/newsletters/{domain}/subscribers",
                  },
                ],
              },
            },
          },
          kChat: {
            label: "kChat",
            items: [
              {
                summary: "List channels",
                method: "get",
                endpoint: "/api/v4/channels",
              },
              {
                summary: "Get channel",
                method: "get",
                endpoint: "/api/v4/channels/{channel_id}",
              },
              {
                summary: "Get channel members",
                method: "get",
                endpoint: "/api/v4/channels/{channel_id}/members",
              },
              {
                summary: "Get moderation",
                method: "get",
                endpoint: "/api/v4/channels/{channel_id}/moderations",
              },
              {
                summary: "List groups",
                method: "get",
                endpoint: "/api/v4/groups",
              },
              {
                summary: "List bots",
                method: "get",
                endpoint: "/api/v4/bots",
              },
              {
                summary: "List commands",
                method: "get",
                endpoint: "/api/v4/commands",
              },
              {
                summary: "List roles",
                method: "get",
                endpoint: "/api/v4/roles",
              },
              {
                summary: "Create a channel",
                method: "post",
                endpoint: "/api/v4/channels",
              },
              {
                summary: "Update channel moderation",
                method: "put",
                endpoint: "/api/v4/channels/{channel_id}/moderations/patch",
              },
              {
                summary: "Add channel members",
                method: "post",
                endpoint: "/api/v4/channels/{channel_id}/members",
              },
              {
                summary: "Update member roles",
                method: "put",
                endpoint:
                  "/api/v4/channels/{channel_id}/members/{user_id}/roles",
              },
              {
                summary: "Delete a bot",
                method: "delete",
                endpoint: "/api/v4/bots/{bot_user_id}",
              },
              {
                summary: "Delete a command",
                method: "delete",
                endpoint: "/api/v4/commands/{command_id}",
              },
              {
                summary: "Channel posts",
                method: "get",
                endpoint: "/api/v4/channels/{channel_id}/posts",
              },
              {
                summary: "Post detail",
                method: "get",
                endpoint: "/api/v4/posts/{post_id}",
              },
              {
                summary: "User preferences",
                method: "get",
                endpoint: "/api/v4/users/{user_id}/preferences",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }) as typeof fetch;

    const result = (await apiCoverageReportTool.handler({
      limit: 50,
      docs_url: "https://developer.infomaniak.com/docs/api",
    })) as {
      covered_examples: Array<{
        endpoint: string;
        classification: string;
        covered_by: string[];
      }>;
      candidates: Array<{
        endpoint: string;
        classification: string;
        covered_by: string[];
      }>;
    };

    expect(result.covered_examples).toContainEqual(
      expect.objectContaining({
        endpoint: "/1/accounts/{account}/invitations/{invitation}",
        classification: "covered",
        covered_by: ["infomaniak_get_account_invitation_access"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/1/accounts/{account}/invitations",
        classification: "dangerous_write",
        covered_by: ["infomaniak_create_account_invitation"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/1/accounts/{account}/invitations/{invitation}/ksuite",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_account_invitation_access"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint:
          "/1/accounts/{account}/invitations/{invitation}/mailbox/invite",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_account_invitation_access"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/1/accounts/{account}/invitations/{invitation}/kchat",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_account_invitation_access"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/1/accounts/{account}/teams",
        classification: "dangerous_write",
        covered_by: ["infomaniak_create_account_team"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/1/accounts/{account}/tags",
        classification: "dangerous_write",
        covered_by: ["infomaniak_create_account_tag"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint:
          "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/aliases",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_mailbox_aliases"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint:
          "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/forwarding_addresses",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_mailbox_forwarding"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint:
          "/1/mail_hostings/{mail_hosting_id}/redirections/{redirection_id}/send-confirmation-requests",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_service_redirections"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/1/mail_hostings/{mail_hosting_id}/diagnostic/dkim/rotate",
        classification: "dangerous_write",
        covered_by: ["infomaniak_rotate_mail_dkim"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint:
          "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures/{signature}",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_mail_signatures"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint:
          "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/webmail/users/{user_id}",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_mail_webmail_access"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint:
          "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/devices/{device_access}",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_mail_device_access"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/1/newsletters/{domain}/groups",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_newsletter_admin"],
      }),
    );
    expect(result.covered_examples).toContainEqual(
      expect.objectContaining({
        endpoint: "/api/v4/channels",
        classification: "covered",
        covered_by: ["infomaniak_list_kchat_channels"],
      }),
    );
    expect(result.covered_examples).toContainEqual(
      expect.objectContaining({
        endpoint: "/api/v4/groups",
        classification: "covered",
        covered_by: ["infomaniak_list_kchat_groups"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/api/v4/channels/{channel_id}/moderations/patch",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_kchat_channel"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/api/v4/channels/{channel_id}/members/{user_id}/roles",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_kchat_channel_members"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/api/v4/bots/{bot_user_id}",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_kchat_bot"],
      }),
    );
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        endpoint: "/api/v4/commands/{command_id}",
        classification: "dangerous_write",
        covered_by: ["infomaniak_manage_kchat_command"],
      }),
    );
    expect(result.out_of_scope_examples).toContainEqual(
      expect.objectContaining({
        endpoint: "/api/v4/channels/{channel_id}/posts",
        classification: "end_user_out_of_scope",
      }),
    );
    expect(result.out_of_scope_examples).toContainEqual(
      expect.objectContaining({
        endpoint: "/api/v4/users/{user_id}/preferences",
        classification: "end_user_out_of_scope",
      }),
    );
    expect(result.summary["covered"]).toBeGreaterThanOrEqual(1);
  });
});
