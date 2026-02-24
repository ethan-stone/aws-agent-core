#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AgentCoreStack } from '../lib/agent-core-stack';

const app = new cdk.App();
new AgentCoreStack(app, 'AgentCoreStack');
