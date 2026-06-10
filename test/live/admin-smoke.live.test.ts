import { describe, expect, it } from "vitest";

import {
  auditAccountAccessTool,
  getUserAppAccessesTool,
  listAccountUsersTool,
} from "../../src/tools/account-access.js";
import {
  getMailboxSecurityTool,
  listMailboxFiltersTool,
} from "../../src/tools/mail-security.js";

const live = process.env["INFOMANIAK_LIVE_TESTS"] === "1";

describe.runIf(live)("live admin smoke tests", () => {
  it.runIf(process.env["INFOMANIAK_TEST_ACCOUNT_ID"])(
    "can read account users and account access audit",
    async () => {
      const accountId = Number(process.env["INFOMANIAK_TEST_ACCOUNT_ID"]);

      const users = (await listAccountUsersTool.handler({
        account_id: accountId,
      })) as {
        count: number;
      };
      const audit = (await auditAccountAccessTool.handler({
        account_id: accountId,
      })) as {
        account_id: number;
      };

      expect(users.count).toBeGreaterThanOrEqual(0);
      expect(audit.account_id).toBe(accountId);
    },
  );

  it.runIf(
    process.env["INFOMANIAK_TEST_ACCOUNT_ID"] &&
      process.env["INFOMANIAK_TEST_USER_ID"],
  )("can read app accesses for a selected account user", async () => {
    const accountId = Number(process.env["INFOMANIAK_TEST_ACCOUNT_ID"]);
    const userId = Number(process.env["INFOMANIAK_TEST_USER_ID"]);

    const accesses = (await getUserAppAccessesTool.handler({
      account_id: accountId,
      user_id: userId,
    })) as { account_id: number; user_id: number; count: number };

    expect(accesses.account_id).toBe(accountId);
    expect(accesses.user_id).toBe(userId);
    expect(accesses.count).toBeGreaterThanOrEqual(0);
  });

  it.runIf(
    process.env["INFOMANIAK_TEST_MAIL_HOSTING_ID"] &&
      process.env["INFOMANIAK_TEST_MAILBOX"],
  )("can read mailbox security and filter inventory", async () => {
    const mailHostingId = Number(
      process.env["INFOMANIAK_TEST_MAIL_HOSTING_ID"],
    );
    const mailboxName = String(process.env["INFOMANIAK_TEST_MAILBOX"]);

    const security = (await getMailboxSecurityTool.handler({
      mail_hosting_id: mailHostingId,
      mailbox_name: mailboxName,
    })) as { mailbox_name: string };
    const filters = (await listMailboxFiltersTool.handler({
      mail_hosting_id: mailHostingId,
      mailbox_name: mailboxName,
    })) as { mailbox_name: string };

    expect(security.mailbox_name).toBe(mailboxName);
    expect(filters.mailbox_name).toBe(mailboxName);
  });
});
