import {
  auditAccountAccessTool,
  cancelPendingInvitationsTool,
  getUserAppAccessesTool,
  listAccountUsersTool,
  planUserOffboardingTool,
} from "./account-access.js";
import {
  addAccountTeamUsersTool,
  createAccountInvitationTool,
  createAccountTagTool,
  createAccountTeamTool,
  deleteAccountInvitationTool,
  deleteAccountTagTool,
  deleteAccountTeamTool,
  removeAccountTeamUsersTool,
  updateAccountInvitationTool,
  updateAccountTagTool,
  updateAccountTeamTool,
} from "./account-admin.js";
import {
  getAccountResourcesTool,
  getDomainResourcesTool,
  manageAccountB2bTool,
  manageDomainNameserversTool,
} from "./account-domain-expansion.js";
import { getAccountFullTool, listTeamsAndTagsTool } from "./account-deep.js";
import {
  getAccountInvitationAccessTool,
  manageAccountInvitationAccessTool,
} from "./account-invitation-access.js";
import { listAiModelsTool, listAiProductsTool } from "./ai.js";
import {
  getAiBatchResultTool,
  getAiConsumptionsTool,
  listAiProductModelsTool,
} from "./ai-expansion.js";
import { apiCallTool } from "./api-call.js";
import { apiCoverageReportTool } from "./api-coverage.js";
import { auditLogSearchTool, auditLogTailTool } from "./audit-log.js";
import { auditAccountTool } from "./audit.js";
import {
  createDatabaseTool,
  deleteDatabaseTool,
  getDatabaseTool,
  getDatabaseUserTool,
  listDatabaseUsersTool,
  listDatabasesTool,
} from "./databases.js";
import {
  dnsCreateRecordTool,
  dnsDeleteRecordTool,
  dnsListRecordsTool,
  dnsUpdateRecordTool,
} from "./dns.js";
import { manageDnssecTool } from "./dnssec.js";
import { getDomainFullTool } from "./domain-deep.js";
import { auditDomainDnsAdminTool } from "./domain-dns-admin.js";
import { getDomainTool, listDomainsTool } from "./domains.js";
import {
  auditKdriveAdminTool,
  createDriveShareLinkTool,
  createDriveFileAccessInvitationTool,
  createDriveFileAccessTeamTool,
  createDriveFileAccessUserTool,
  createDriveUserTool,
  deleteDriveUserTool,
  emptyDriveTrashTool,
  getDriveShareLinkTool,
  getDriveStatisticsTool,
  listDriveFileAccessInvitationsTool,
  listDriveFileAccessTeamsTool,
  listDriveFileAccessUsersTool,
  inviteDriveShareLinkTool,
  listDriveShareLinksTool,
  lockDriveUserTool,
  removeDriveFileAccessTeamTool,
  removeDriveFileAccessUserTool,
  removeDriveTrashItemTool,
  removeDriveShareLinkTool,
  restoreDriveTrashItemTool,
  setDriveUserManagerTool,
  unlockDriveUserTool,
  updateDriveTrashSettingsTool,
  updateDriveShareLinkTool,
  updateDriveFileAccessTeamTool,
  updateDriveFileAccessUserTool,
  updateDriveUserTool,
} from "./drive-admin.js";
import {
  createDriveActivityReportTool,
  deleteDriveActivityReportTool,
  exportDriveActivityReportTool,
  getDriveActivitiesTool,
  getDriveActivityReportTool,
  getDriveFileActivitiesTool,
  getDriveInvitationTool,
  getDriveRootActivitiesTool,
  getDriveUserTool,
  listDriveActivityReportsTool,
  listDriveInvitationsTool,
  manageDrivePrivateDirectoryTool,
} from "./kdrive-expansion.js";
import {
  getDriveFullTool,
  listDriveTrashTool,
  listDriveUsersTool,
} from "./drive-deep.js";
import {
  getDriveSettingsTool,
  manageDriveSettingsTool,
} from "./drive-settings.js";
import { listDriveFilesTool, listDrivesTool } from "./drive.js";
import { findSiteTool } from "./find-site.js";
import {
  createHostingUserTool,
  deleteHostingUserTool,
  listHostingUsersTool,
} from "./ftp-users.js";
import { listHostingsTool } from "./hostings.js";
import { explainTool, helpTool, toolCatalogTool } from "./introspection.js";
import {
  getKchatBotTool,
  getKchatChannelModerationTool,
  getKchatChannelTool,
  getKchatCommandTool,
  listKchatBotsTool,
  listKchatChannelMembersTool,
  listKchatChannelsTool,
  listKchatCommandsTool,
  listKchatGroupsTool,
  listKchatRolesTool,
  listKchatTeamChannelsTool,
  manageKchatBotTool,
  manageKchatChannelMembersTool,
  manageKchatChannelTool,
  manageKchatCommandTool,
} from "./kchat-admin.js";
import { getMailAccessTool, manageMailAccessTool } from "./mail-access.js";
import {
  manageMailboxAliasesTool,
  manageMailboxAutoReplyTool,
  manageMailboxForwardingTool,
  manageServiceRedirectionsTool,
  rotateMailDkimTool,
} from "./mail-admin.js";
import { getMailHostingFullTool, getMailboxFullTool } from "./mail-deep.js";
import { getMailDevicesTool, manageMailDevicesTool } from "./mail-devices.js";
import { getMailboxInfoTool } from "./mail-extras.js";
import {
  authorizeSenderTool,
  auditMailboxSecurityTool,
  blockSenderTool,
  createMailboxFilterTool,
  deleteMailboxFilterScriptTool,
  deleteMailboxFilterTool,
  getMailboxSecurityTool,
  hardenMailboxSecurityTool,
  listMailboxFilterScriptsTool,
  listMailboxFiltersTool,
  purgeSpamFolderTool,
  setMailboxSpamPolicyTool,
  updateMailboxFoldersTool,
  updateMailboxFilterTool,
  unauthorizeSenderTool,
  unblockSenderTool,
  upsertMailboxFilterScriptTool,
} from "./mail-security.js";
import {
  emptyMailboxTrashTool,
  getMailPreferencesTool,
  listEmailImportsTool,
  listMailingListsTool,
  listServiceAutoRepliesTool,
  listServiceFilterModelsTool,
  manageMailboxFilterLifecycleTool,
} from "./mail-expansion.js";
import {
  getMailSignaturesTool,
  manageMailSignaturesTool,
} from "./mail-signatures.js";
import {
  createAliasTool,
  createMailboxTool,
  deleteMailboxTool,
} from "./mail-write.js";
import { listMailHostingsTool, listMailboxesTool } from "./mail.js";
import {
  getNewsletterAdminTool,
  manageNewsletterAdminTool,
} from "./newsletters.js";
import {
  getNodejsAppTool,
  listNodejsAppsTool,
  nodejsAppActionTool,
  nodejsAppAliasesTool,
  nodejsAppJobsTool,
  nodejsAppLogsTool,
  nodejsAppStatusTool,
  nodejsAppThumbnailTool,
} from "./nodejs.js";
import { listOrganizationsTool } from "./organizations.js";
import {
  getPublicCloudProjectTool,
  getPublicCloudDatabaseServiceTool,
  getPublicCloudKubernetesServiceTool,
  getPublicCloudTool,
  listPublicCloudAccessesTool,
  listPublicCloudDatabaseServicesTool,
  listPublicCloudKubernetesServicesTool,
  listPublicCloudProjectUsersTool,
  listPublicCloudProjectsTool,
  listPublicCloudResourceDataTool,
  listPublicCloudsTool,
  getPublicCloudStatusTool,
  managePublicCloudDatabaseServiceTool,
  managePublicCloudKubernetesServiceTool,
  managePublicCloudProjectTool,
  managePublicCloudProjectUserTool,
} from "./public-cloud.js";
import { overviewTool } from "./overview.js";
import { getMyProfileTool, getMySecurityTool } from "./profile.js";
import {
  createRedirectionTool,
  deleteRedirectionTool,
  listRedirectionsTool,
} from "./redirections.js";
import { historyTool, undoTool } from "./session.js";
import {
  addSiteAliasesTool,
  deleteSiteAliasTool,
  listSiteAliasesTool,
} from "./site-aliases.js";
import { createSiteTool, deleteSiteTool, listSitesTool } from "./sites.js";
import {
  deleteCertificateTool,
  getCertificateTool,
  requestCertificateTool,
} from "./ssl.js";
import { listSwissBackupsTool } from "./swiss-backup.js";
import {
  getSwissBackupAcronisInfoTool,
  getSwissBackupPricingTool,
  getSwissBackupSlotTool,
  getSwissBackupTool,
  listSwissBackupSlotsTool,
  manageSwissBackupAdministratorTool,
  manageSwissBackupSlotTool,
} from "./swiss-backup-expansion.js";
import type { ToolDefinition } from "./types.js";
import {
  createShortUrlTool,
  listShortUrlsTool,
  shortUrlsQuotaTool,
} from "./url-shortener.js";
import { getVpsFullTool, listVpsTool } from "./vps.js";
import { auditDnsZonesTool, provisionSiteFullTool } from "./workflows.js";

export const tools: ReadonlyArray<ToolDefinition> = [
  // Help and audit
  overviewTool,
  toolCatalogTool,
  helpTool,
  explainTool,
  auditAccountTool,
  apiCoverageReportTool,
  auditLogTailTool,
  auditLogSearchTool,
  auditDnsZonesTool,
  historyTool,
  undoTool,
  // Profile
  getMyProfileTool,
  getMySecurityTool,
  // Workflows
  provisionSiteFullTool,
  // Account
  listOrganizationsTool,
  getAccountFullTool,
  listTeamsAndTagsTool,
  listAccountUsersTool,
  getUserAppAccessesTool,
  planUserOffboardingTool,
  auditAccountAccessTool,
  cancelPendingInvitationsTool,
  getAccountInvitationAccessTool,
  manageAccountInvitationAccessTool,
  createAccountInvitationTool,
  updateAccountInvitationTool,
  deleteAccountInvitationTool,
  createAccountTeamTool,
  updateAccountTeamTool,
  deleteAccountTeamTool,
  addAccountTeamUsersTool,
  removeAccountTeamUsersTool,
  createAccountTagTool,
  updateAccountTagTool,
  deleteAccountTagTool,
  getAccountResourcesTool,
  manageAccountB2bTool,
  listHostingsTool,
  listDomainsTool,
  getDomainTool,
  getDomainFullTool,
  getDomainResourcesTool,
  manageDomainNameserversTool,
  // Web hosting
  findSiteTool,
  listSitesTool,
  createSiteTool,
  deleteSiteTool,
  listSiteAliasesTool,
  addSiteAliasesTool,
  deleteSiteAliasTool,
  getCertificateTool,
  requestCertificateTool,
  deleteCertificateTool,
  listDatabasesTool,
  getDatabaseTool,
  createDatabaseTool,
  deleteDatabaseTool,
  listDatabaseUsersTool,
  getDatabaseUserTool,
  listHostingUsersTool,
  createHostingUserTool,
  deleteHostingUserTool,
  // DNS
  dnsListRecordsTool,
  dnsCreateRecordTool,
  dnsUpdateRecordTool,
  dnsDeleteRecordTool,
  auditDomainDnsAdminTool,
  manageDnssecTool,
  // Mail
  listMailHostingsTool,
  listMailboxesTool,
  getMailboxInfoTool,
  getMailboxSecurityTool,
  listMailboxFiltersTool,
  listMailboxFilterScriptsTool,
  auditMailboxSecurityTool,
  getMailHostingFullTool,
  getMailboxFullTool,
  getMailSignaturesTool,
  getMailAccessTool,
  getMailDevicesTool,
  createMailboxTool,
  deleteMailboxTool,
  createAliasTool,
  blockSenderTool,
  unblockSenderTool,
  authorizeSenderTool,
  unauthorizeSenderTool,
  setMailboxSpamPolicyTool,
  hardenMailboxSecurityTool,
  updateMailboxFoldersTool,
  purgeSpamFolderTool,
  createMailboxFilterTool,
  updateMailboxFilterTool,
  deleteMailboxFilterTool,
  upsertMailboxFilterScriptTool,
  deleteMailboxFilterScriptTool,
  listEmailImportsTool,
  manageMailboxFilterLifecycleTool,
  emptyMailboxTrashTool,
  listMailingListsTool,
  listServiceAutoRepliesTool,
  getMailPreferencesTool,
  listServiceFilterModelsTool,
  manageMailboxAliasesTool,
  manageMailboxForwardingTool,
  manageMailboxAutoReplyTool,
  manageServiceRedirectionsTool,
  rotateMailDkimTool,
  manageMailSignaturesTool,
  // kChat admin
  listKchatChannelsTool,
  listKchatTeamChannelsTool,
  getKchatChannelTool,
  listKchatChannelMembersTool,
  getKchatChannelModerationTool,
  listKchatGroupsTool,
  listKchatRolesTool,
  listKchatBotsTool,
  getKchatBotTool,
  listKchatCommandsTool,
  getKchatCommandTool,
  manageKchatChannelTool,
  manageKchatChannelMembersTool,
  manageKchatBotTool,
  manageKchatCommandTool,
  manageMailAccessTool,
  manageMailDevicesTool,
  // Mail redirections
  listRedirectionsTool,
  createRedirectionTool,
  deleteRedirectionTool,
  // Newsletter
  getNewsletterAdminTool,
  manageNewsletterAdminTool,
  // kDrive
  listDrivesTool,
  listDriveFilesTool,
  getDriveFullTool,
  listDriveUsersTool,
  listDriveTrashTool,
  auditKdriveAdminTool,
  listDriveShareLinksTool,
  getDriveShareLinkTool,
  getDriveStatisticsTool,
  getDriveSettingsTool,
  listDriveFileAccessUsersTool,
  listDriveFileAccessTeamsTool,
  listDriveFileAccessInvitationsTool,
  createDriveShareLinkTool,
  updateDriveShareLinkTool,
  removeDriveShareLinkTool,
  inviteDriveShareLinkTool,
  createDriveFileAccessUserTool,
  updateDriveFileAccessUserTool,
  removeDriveFileAccessUserTool,
  createDriveFileAccessTeamTool,
  updateDriveFileAccessTeamTool,
  removeDriveFileAccessTeamTool,
  createDriveFileAccessInvitationTool,
  createDriveUserTool,
  updateDriveUserTool,
  deleteDriveUserTool,
  lockDriveUserTool,
  unlockDriveUserTool,
  setDriveUserManagerTool,
  emptyDriveTrashTool,
  restoreDriveTrashItemTool,
  removeDriveTrashItemTool,
  updateDriveTrashSettingsTool,
  manageDriveSettingsTool,
  getDriveActivitiesTool,
  getDriveFileActivitiesTool,
  getDriveRootActivitiesTool,
  listDriveActivityReportsTool,
  getDriveActivityReportTool,
  exportDriveActivityReportTool,
  createDriveActivityReportTool,
  deleteDriveActivityReportTool,
  getDriveUserTool,
  listDriveInvitationsTool,
  getDriveInvitationTool,
  manageDrivePrivateDirectoryTool,
  // AI
  listAiProductsTool,
  listAiModelsTool,
  getAiConsumptionsTool,
  getAiBatchResultTool,
  listAiProductModelsTool,
  // Public Cloud
  listPublicCloudsTool,
  getPublicCloudTool,
  listPublicCloudAccessesTool,
  getPublicCloudStatusTool,
  listPublicCloudProjectsTool,
  getPublicCloudProjectTool,
  listPublicCloudProjectUsersTool,
  listPublicCloudDatabaseServicesTool,
  getPublicCloudDatabaseServiceTool,
  listPublicCloudKubernetesServicesTool,
  getPublicCloudKubernetesServiceTool,
  listPublicCloudResourceDataTool,
  managePublicCloudProjectTool,
  managePublicCloudProjectUserTool,
  managePublicCloudDatabaseServiceTool,
  managePublicCloudKubernetesServiceTool,
  // VPS
  listVpsTool,
  getVpsFullTool,
  // Node.js hosting
  listNodejsAppsTool,
  getNodejsAppTool,
  nodejsAppStatusTool,
  nodejsAppAliasesTool,
  nodejsAppJobsTool,
  nodejsAppLogsTool,
  nodejsAppThumbnailTool,
  nodejsAppActionTool,
  // Swiss Backup
  listSwissBackupsTool,
  getSwissBackupTool,
  getSwissBackupAcronisInfoTool,
  listSwissBackupSlotsTool,
  getSwissBackupSlotTool,
  getSwissBackupPricingTool,
  manageSwissBackupSlotTool,
  manageSwissBackupAdministratorTool,
  // URL Shortener
  listShortUrlsTool,
  shortUrlsQuotaTool,
  createShortUrlTool,
  // Raw API
  apiCallTool,
];

export type { ToolDefinition } from "./types.js";
