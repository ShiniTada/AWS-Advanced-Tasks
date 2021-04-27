import * as codebuild from '@aws-cdk/aws-codebuild'
import * as codecommit from '@aws-cdk/aws-codecommit'
import * as codepipeline from '@aws-cdk/aws-codepipeline'
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions'
import * as lambda from '@aws-cdk/aws-lambda'
import { App, Stack, StackProps } from '@aws-cdk/core'

export interface PipelineStackProps extends StackProps {
  readonly lambdaCode: lambda.CfnParametersCode
  readonly lambdaSqsHandlerCode: lambda.CfnParametersCode
  readonly lambdaSqsStepFunctionProxyCode: lambda.CfnParametersCode
  readonly lambdaStepFunctionCode: lambda.CfnParametersCode
  readonly repoName: string
}

export class PipelineStack extends Stack {
  constructor(app: App, id: string, props: PipelineStackProps) {
    super(app, id, props)

    const code = codecommit.Repository.fromRepositoryName(this, 'ImportedRepo',
      props.repoName)

    const cdkBuild = new codebuild.PipelineProject(this, 'CdkBuild', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [ 
              'npm install -g npm', 
              'npm ci',
            ],
          },
          build: {
            commands: [
              'npm run build',
              'npm run cdk synth -- -o dist'
            ],
          },
        },
        artifacts: {
          'base-directory': 'dist',
          files: [
            'LambdaStack.template.json',
          ],
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_2_0,
      },
    })
    const installCommands = [
      'cd lambda',
      'npm install -g npm',
      'npm ci',
    ],
     buildFiles = [            
      '../node_modules/aws-xray-sdk/**/*',
      '../node_modules/aws-xray-sdk-core/**/*',
      '../node_modules/aws-xray-sdk-express/**/*',
      '../node_modules/aws-xray-sdk-mysql/**/*',
      '../node_modules/aws-xray-sdk-postgres/**/*',
      '../node_modules/cls-hooked/**/*',
      '../node_modules/semver/**/*',
      '../node_modules/emitter-listener/**/*',
      '../node_modules/shimmer/**/*',
      '../node_modules/atomic-batcher/**/*',
      '../node_modules/pkginfo/**/*',
    ]
    const lambdaBuild = new codebuild.PipelineProject(this, 'LambdaBuild', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: installCommands,
          },
          build: {
            commands: 'npm run build',
          },
        },
        artifacts: {
          'base-directory': 'lambda',
          files: [
            ...buildFiles,
            'function.js',            
          ],
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_2_0,
      },
    })
    const sqsEventHandlerBuild = new codebuild.PipelineProject(this, 'SqsEventHandlerBuild', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: installCommands,
          },
          build: {
            commands: 'npm run build',
          },
        },
        artifacts: {
          'base-directory': 'lambda',
          files: [
            ...buildFiles,
            'sqshandler.js',
            'generator.js',
            'scheduledlambda.js',
          ],
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_2_0,
      },
    })
    const sqsStepFunctionProxyBuild = new codebuild.PipelineProject(this, 'SqsStepFunctionProxyBuild', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: installCommands,
          },
          build: {
            commands: 'npm run build',
          },
        },
        artifacts: {
          'base-directory': 'lambda',
          files: [
            ...buildFiles,
            'sqsstepfunc.js',
          ],
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_2_0,
      },
    })
    const stepFunctionBuild = new codebuild.PipelineProject(this, 'StepFunctionBuild', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: installCommands,
          },
          build: {
            commands: 'npm run build',
          },
        },
        artifacts: {
          'base-directory': 'lambda',
          files: [
            ...buildFiles,
            'stepfunc.js',
          ],
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_2_0,
      },
    })
    const sourceOutput = new codepipeline.Artifact(),
      cdkBuildOutput = new codepipeline.Artifact('CdkBuildOutput'),
      lambdaBuildOutput = new codepipeline.Artifact('LambdaBuildOutput'),
      sqsEventHandlerBuildOutput = new codepipeline.Artifact('SqsEventHandlerBuildOutput'),
      sqsStepFunctionProxyBuildOutput = new codepipeline.Artifact('SqsStepFunctionProxyBuildOutput'),
      stepFunctionBuildOutput = new codepipeline.Artifact('StepFunctionBuildOutput')
    new codepipeline.Pipeline(this, 'Pipeline', {
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.CodeCommitSourceAction({
              actionName: 'CodeCommit_Source',
              repository: code,
              output: sourceOutput,
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'Lambda_Build',
              project: lambdaBuild,
              input: sourceOutput,
              outputs: [lambdaBuildOutput],
            }),
            new codepipeline_actions.CodeBuildAction({
              actionName: 'SqsEventHandler_Build',
              project: sqsEventHandlerBuild,
              input: sourceOutput,
              outputs: [sqsEventHandlerBuildOutput],
            }),
            new codepipeline_actions.CodeBuildAction({
              actionName: 'CDK_Build',
              project: cdkBuild,
              input: sourceOutput,
              outputs: [cdkBuildOutput],
            }),
            new codepipeline_actions.CodeBuildAction({
              actionName: 'SqsStepFunctionProxy_Build',
              project: sqsStepFunctionProxyBuild,
              input: sourceOutput,
              outputs: [sqsStepFunctionProxyBuildOutput],
            }), 
            new codepipeline_actions.CodeBuildAction({
              actionName: 'StepFunction_Build',
              project: stepFunctionBuild,
              input: sourceOutput,
              outputs: [stepFunctionBuildOutput],
            }),
          ],
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: 'Lambda_Deploy',
              templatePath: cdkBuildOutput.atPath('LambdaStack.template.json'),
              stackName: 'LambdaDeploymentStack',
              adminPermissions: true,
              parameterOverrides: {
                ...props.lambdaCode.assign(lambdaBuildOutput.s3Location),
                ...props.lambdaSqsHandlerCode.assign(sqsEventHandlerBuildOutput.s3Location),
                ...props.lambdaSqsStepFunctionProxyCode.assign(sqsStepFunctionProxyBuildOutput.s3Location),
                ...props.lambdaStepFunctionCode.assign(stepFunctionBuildOutput.s3Location),
              },
              extraInputs: [
                lambdaBuildOutput, 
                sqsEventHandlerBuildOutput, 
                sqsStepFunctionProxyBuildOutput, 
                stepFunctionBuildOutput,
              ],
            }),
          ],
        },
      ],
    })
  }
}