import {
  appendRunItems,
  claimConversationActiveRun,
  createAgentRun,
  createConversation,
  createRuntimeSession,
  getConversation,
  getConversationDetail,
  getRuntimeSessionByProvider,
  touchRuntimeSession,
  updateAgentRunStatus,
  updateConversationActiveRun,
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
    updateStatus: updateAgentRunStatus,
  },
  runItems: {
    append: appendRunItems,
  },
} as const;
