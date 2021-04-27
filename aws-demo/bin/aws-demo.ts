#!/usr/bin/env node
import { App } from '@aws-cdk/core'
import { LambdaStack } from '../lib/lambda-stack'
import { PipelineStack } from '../lib/pipeline-stack'

const CODECOMMIT_REPO_NAME = "aws-demo"

const app = new App()

const lambdaStack = new LambdaStack(app, 'LambdaStack')
new PipelineStack(app, 'PipelineDeployingLambdaStack', {
  lambdaCode: lambdaStack.lambdaCode,
  lambdaSqsHandlerCode: lambdaStack.lambdaSqsHandlerCode,
  lambdaSqsStepFunctionProxyCode: lambdaStack.lambdaSqsStepFunctionProxyCode,
  lambdaStepFunctionCode: lambdaStack.lambdaStepFunctionCode,
  repoName: CODECOMMIT_REPO_NAME
})

app.synth()