import {
  appendRunItems,
  claimConversationActiveRun,
  createAgentRun,
  createAgentRunSnapshot,
  createConversation,
  createRuntimeSession,
  getAgentRun,
  getAgentRunSnapshot,
  getConversation,
  getConversationDetail,
  getRuntimeSessionByProvider,
  listRunItems,
  touchRuntimeSession,
  updateAgentRunStatus,
  updateConversationActiveRun,
  updateRequiredActionStatus,
} from "../../../../shared/pulseforge-backend/src/index.js";

export const agentConversationStorage = {
  conversations: {
    create: createConversation,
    get: getConversation,
    getDetail: getConversationDetail,
    claimActiveRootRun: claimConversationActiveRun,
    setActiveRootRun: updateConversationActiveRun,
  },
  runtimeSessions: {
    create: createRuntimeSession,
    getByProvider: getRuntimeSessionByProvider,
    updateUsage: touchRuntimeSession,
  },
  agentRuns: {
    create: createAgentRun,
    get: getAgentRun,
    updateStatus: updateAgentRunStatus,
  },
  agentRunSnapshots: {
    create: createAgentRunSnapshot,
    get: getAgentRunSnapshot,
  },
  runItems: {
    append: appendRunItems,
    list: listRunItems,
    updateRequiredActionStatus,
  },
} as const;
