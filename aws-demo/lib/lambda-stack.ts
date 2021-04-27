import * as lambda from '@aws-cdk/aws-lambda'
import { App, Stack, StackProps, Duration } from '@aws-cdk/core'
const lambdaevent = require("@aws-cdk/aws-lambda-event-sources")
const apigw = require("@aws-cdk/aws-apigateway")
const dynamodb = require('@aws-cdk/aws-dynamodb')
const sqs = require("@aws-cdk/aws-sqs")
const subs = require("@aws-cdk/aws-sns-subscriptions")

const sns = require("@aws-cdk/aws-sns")
const s3 = require("@aws-cdk/aws-s3")
const sfn = require('@aws-cdk/aws-stepfunctions')
const tasks = require('@aws-cdk/aws-stepfunctions-tasks')
const iam = require('@aws-cdk/aws-iam')
const kms = require('@aws-cdk/aws-kms')
const smanager = require('@aws-cdk/aws-secretsmanager')
const events = require('@aws-cdk/aws-events')
const targets = require('@aws-cdk/aws-events-targets')
const cloudwatch = require('@aws-cdk/aws-cloudwatch')
const cw_actions = require('@aws-cdk/aws-cloudwatch-actions')


export class LambdaStack extends Stack {
  public readonly lambdaCode: lambda.CfnParametersCode
  public readonly lambdaSqsHandlerCode: lambda.CfnParametersCode
  public readonly lambdaSqsStepFunctionProxyCode: lambda.CfnParametersCode
  public readonly lambdaStepFunctionCode: lambda.CfnParametersCode

  constructor(app: App, id: string, props?: StackProps) {
    super(app, id, props)

    this.lambdaCode = lambda.Code.fromCfnParameters()
    this.lambdaSqsHandlerCode = lambda.Code.fromCfnParameters()
    this.lambdaSqsStepFunctionProxyCode = lambda.Code.fromCfnParameters()
    this.lambdaStepFunctionCode = lambda.Code.fromCfnParameters()

    // create KMS Custom Managed Key
    const kmsKey = new kms.Key(this, 'CustomManagedKey');
    kmsKey.addAlias('alias/demo');

    // create DynamoDB table
    const table = new dynamodb.Table(this, 'EmailStatusStorage', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey
    })

    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy')
    );

    const layer = lambda.LayerVersion.fromLayerVersionArn(
      this, `LayerFromArn`, 'arn:aws:lambda:us-east-1:580247275435:layer:LambdaInsightsExtension:14')

    // create Lambda
    const lambdaSingleRequest = new lambda.Function(this, 'Lambda', {
      code: this.lambdaCode,
      handler: 'function.handler',
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: {
        TABLE_NAME: table.tableName
      },
      environmentEncryption: kmsKey,
      tracing: lambda.Tracing.ACTIVE,
      role: lambdaRole,
      layers: [layer],
      timeout: Duration.seconds(15),
    })
    table.grantReadWriteData(lambdaSingleRequest)

    // Create Api Gateway
    const api = new apigw.RestApi(this, "SingleEventsInputAPI")

    // Create lambda integration
    const integration = new apigw.LambdaIntegration(lambdaSingleRequest, {
      proxy: false,
      allowTestInvoke: true,
      integrationResponses: [
        {
          statusCode: "202",
          responseTemplates: {
            // This template takes the "message" result from the Lambda function, and convert into payload size
            'application/json': JSON.stringify({ payloadSize: '$util.escapeJavaScript($input.body.length())' })
          },
          responseParameters: {
            'method.response.header.Content-Type': "'application/json'",
          }
        }
      ]
    })

    // Define the JSON Schema for the transformed valid request
    const reqModel = api.addModel('RequestModel', {
      contentType: 'application/json',
      modelName: 'RequestModel',
      schema: {
        schema: apigw.JsonSchemaVersion.DRAFT4,
        title: 'validRequest',
        type: apigw.JsonSchemaType.OBJECT,
        properties: {
          id: { type: apigw.JsonSchemaType.STRING },
          type: { type: apigw.JsonSchemaType.STRING },
          data: { type: apigw.JsonSchemaType.OBJECT }
        },
        required: ["id", "type", "data"]
      }
    })

    const lambdaAuthRole = new iam.Role(this, 'LambdaAuthRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    lambdaAuthRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy')
    );

    // lambda for Request authorizer
    const lambdaAuthorizer = new lambda.Function(this, 'LambdaAuth', {
      code: this.lambdaCode,
      handler: 'function.authorizer',
      runtime: lambda.Runtime.NODEJS_10_X,
      tracing: lambda.Tracing.ACTIVE,
      role: lambdaAuthRole,
      timeout: Duration.seconds(15),
    })

    // Create a Lambda Request authorizer
    const auth = new apigw.RequestAuthorizer(this, 'RequestAuthorizer', {
      handler: lambdaAuthorizer,
      identitySources: [apigw.IdentitySource.header('UserAgent')],
      resultsCacheTtl: Duration.minutes(3)
    })

    // Add path and method
    const notificationPostMethod = api.root
      .resourceForPath("api")
      .resourceForPath("notifications")
      .addMethod("POST", integration, {
        requestValidatorOptions: {
          requestValidatorName: 'request-validator',
          validateRequestBody: true,
          validateRequestParameters: false
        },
        requestModels: {
          'application/json': reqModel
        },
        methodResponses: [
          {
            // Successful response from the integration
            statusCode: '202',
            // Define what parameters are allowed or not
            responseParameters: {
              'method.response.header.Content-Type': true,
            }
          }
        ],
        apiKeyRequired: true,
        authorizer: auth,
      }
      )

    //By default, the RestApi construct will automatically create an API Gateway Deployment
    // and a "prod" Stage which represent the API configuration you defined in CDK app
    const deployment = new apigw.Deployment(this, 'Deployment', {
      api: api,
    });
    const prodStage = new apigw.Stage(this, 'MainProd', {
      deployment: deployment,
      stageName: 'PROD',
      tracingEnabled: true
    });


    // The name and value of the API Key can be specified at creation
    //if not provided, a name and value will be automatically generated by API Gateway.
    const apiKey1 = api.addApiKey('ApiKey1', {
      apiKeyName: 'apiKey1',
      value: 'apikey12345usedForSilverUsagePlan',
    })
    const apiKey2 = api.addApiKey('ApiKey2', {
      apiKeyName: 'apiKey2',
      value: 'apikey6789usedForGoldUsagePlan',
    })

    const silverPlan = api.addUsagePlan('Silver', {
      name: 'Silver',
      apiKey: apiKey1,
      throttle: { rateLimit: 10, burstLimit: 5 },
      quota: { limit: 1000, period: apigw.Period.MONTH }
    })
    const goldPlan = api.addUsagePlan('Gold', {
      name: 'Gold',
      apiKey: apiKey2,
      throttle: { rateLimit: 20, burstLimit: 5 },
      quota: { limit: 2000, period: apigw.Period.MONTH }
    })

    silverPlan.addApiStage({ stage: prodStage })
    goldPlan.addApiStage({ stage: prodStage })


    //BATCH
    const sqsEventHandlerRole = new iam.Role(this, 'SqsEventHandlerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    sqsEventHandlerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy')
    );

    const lambdaSqsEventHandler = new lambda.Function(this, 'SqsEventHandler', {
      code: this.lambdaSqsHandlerCode,
      handler: 'sqshandler.handler',
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: {
        TABLE_NAME: table.tableName,
      },
      environmentEncryption: kmsKey,
      tracing: lambda.Tracing.ACTIVE,
      role: sqsEventHandlerRole,
      timeout: Duration.seconds(15),
    })
    table.grantReadWriteData(lambdaSqsEventHandler)

    const sqsInputBufferDeadLetter = new sqs.Queue(this, 'SqsInputBufferDeadLetter.fifo', {
      fifo: true,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: kmsKey
    })

    const sqsInputBuffer = new sqs.Queue(this, 'SqsInputBuffer.fifo', {
      fifo: true,
      visibilityTimeout: Duration.minutes(2),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: sqsInputBufferDeadLetter
      },
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: kmsKey
    })
    sqsInputBuffer.grantConsumeMessages(lambdaSqsEventHandler)
    lambdaSqsEventHandler.addEventSource(new lambdaevent.SqsEventSource(sqsInputBuffer))

    const sqsMainQueue = new sqs.Queue(this, 'SqsMainQueue.fifo', {
      fifo: true,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: kmsKey
    })

    sqsMainQueue.grantSendMessages(lambdaSingleRequest)
    sqsMainQueue.grantSendMessages(lambdaSqsEventHandler)

    lambdaSingleRequest.addEnvironment('SEND_TO_SQS', sqsMainQueue.queueUrl)
    lambdaSqsEventHandler.addEnvironment('SEND_TO_SQS', sqsMainQueue.queueUrl)


    // create bucket to store email templates
    const bucketTemplateStorage = new s3.Bucket(this, 'EmailTemplateStorage', {
      accessControl: s3.PUBLIC_READ_WRITE,
      blockPublicAccess: {
        blockPublicAcls: false,
        blockPublicPolicy: false
      },
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey
    })

    const addTemplatesRole = new iam.Role(this, 'AddTemplatesRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    addTemplatesRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy')
    );

    // create a Lambda function that will add default templates in s3 bucket
    const lambdaAddTemplates = new lambda.Function(this, 'AddTemplates', {
      code: this.lambdaStepFunctionCode,
      handler: 'stepfunc.addTemplates',
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: {
        BUCKET_NAME: bucketTemplateStorage.bucketName
      },
      environmentEncryption: kmsKey,
      tracing: lambda.Tracing.ACTIVE,
      role: addTemplatesRole,
      timeout: Duration.seconds(15),
    })
    bucketTemplateStorage.grantReadWrite(lambdaAddTemplates);

    const validateMessageDataRole = new iam.Role(this, 'ValidateMessageDataRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    validateMessageDataRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy')
    );

    // create a Lambda function that will accept input event and validate it
    const lambdaValidateMessageData = new lambda.Function(this, 'ValidateMessageData', {
      code: this.lambdaStepFunctionCode,
      handler: 'stepfunc.validateMessageData',
      runtime: lambda.Runtime.NODEJS_10_X,
      retryAttempts: 0,
      tracing: lambda.Tracing.ACTIVE,
      role: validateMessageDataRole,
      timeout: Duration.seconds(15),
    })

    const findTemplateRole = new iam.Role(this, 'FindTemplateRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    findTemplateRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy')
    );

    // create a Lambda function that will accept template name/id and will return this template from S3 bucket
    const lambdaFindTemplate = new lambda.Function(this, 'FindTemplate', {
      code: this.lambdaStepFunctionCode,
      handler: 'stepfunc.findTemplate',
      runtime: lambda.Runtime.NODEJS_10_X,
      retryAttempts: 0,
      environment: {
        BUCKET_NAME: bucketTemplateStorage.bucketName
      },
      environmentEncryption: kmsKey,
      tracing: lambda.Tracing.ACTIVE,
      role: findTemplateRole,
      timeout: Duration.seconds(15),
    })
    bucketTemplateStorage.grantReadWrite(lambdaFindTemplate);


    const updateRecordInDBRole = new iam.Role(this, 'UpdateRecordInDBRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    updateRecordInDBRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy')
    );

    const lambdaUpdateRecordInDB = new lambda.Function(this, 'UpdateRecordInDB', {
      code: this.lambdaStepFunctionCode,
      handler: 'stepfunc.updateRecordInDB',
      runtime: lambda.Runtime.NODEJS_10_X,
      retryAttempts: 0,
      environment: {
        TABLE_NAME: table.tableName
      },
      environmentEncryption: kmsKey,
      tracing: lambda.Tracing.ACTIVE,
      role: updateRecordInDBRole,
      timeout: Duration.seconds(15),
    })
    table.grantReadWriteData(lambdaUpdateRecordInDB)

    const sendEmailRole = new iam.Role(this, 'EmailRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    sendEmailRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ses:SendEmail',
        'ses:SendRawEmail',
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'xray:PutTraceSegments',
        'xray:PutTelemetryRecords',
      ],
      resources: ['*'],
    }));
    sendEmailRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy')
    );

    // create a Lambda function that will accept data for email and send this email using AWS SES. 
    const lambdaSendEmail = new lambda.Function(this, 'SendEmail', {
      code: this.lambdaStepFunctionCode,
      handler: 'stepfunc.sendEmail',
      runtime: lambda.Runtime.NODEJS_10_X,
      retryAttempts: 0,
      environment: {
        TABLE_NAME: table.tableName
      },
      environmentEncryption: kmsKey,
      role: sendEmailRole,
      tracing: lambda.Tracing.ACTIVE,
      timeout: Duration.seconds(15),
    })
    table.grantReadWriteData(lambdaSendEmail)

    // STEP FUNCTIONS

    const stepWait = new sfn.Wait(this, 'Wait 5 Seconds', {
      time: sfn.WaitTime.duration(Duration.seconds(5)),
    });

    const stepValidate = new tasks.LambdaInvoke(this, 'Validate Message Data', {
      lambdaFunction: lambdaValidateMessageData,
      outputPath: '$.Payload',
    });

    const stepUpdateRecordInDB = new tasks.LambdaInvoke(this, 'Update Record In DB', {
      lambdaFunction: lambdaUpdateRecordInDB,
      outputPath: '$.Payload',
    });

    const stepFindTemplate = new tasks.LambdaInvoke(this, 'Find Template', {
      lambdaFunction: lambdaFindTemplate,
      outputPath: '$.Payload',
    });

    const stepAddTemplates = new tasks.LambdaInvoke(this, 'Add Templates', {
      lambdaFunction: lambdaAddTemplates,
      outputPath: '$.Payload',
    });

    const stepFindTemplateV2 = new tasks.LambdaInvoke(this, 'Find Template v2', {
      lambdaFunction: lambdaFindTemplate,
      outputPath: '$.Payload',
    });

    const stepMarkValidationFailed = new sfn.Pass(this, 'Mark Validation Failed', {
      result: sfn.Result.fromObject({ status: 'VALIDATION_ERROR' }),
      resultPath: '$.needToUpdate',
    });

    const stepMarkNoTemplate = new sfn.Pass(this, 'Mark No Template', {
      result: sfn.Result.fromObject({ status: 'READ_ERROR' }),
      resultPath: '$.needToUpdate',
    });

    const stepInformEmailNotSent = new sfn.Fail(this, 'Inform Email Not Sent', {
      cause: 'Email Not Sent',
      error: 'There were some errors with message information.',
    });

    const stepSendEmail = new tasks.LambdaInvoke(this, 'Send Email', {
      lambdaFunction: lambdaSendEmail,
      outputPath: '$.Payload',
    });

    const stepEmailSent = new sfn.Succeed(this, 'Email Sent');

    const definition = stepValidate
      .next(stepWait)
      .next(new sfn.Choice(this, 'Is Valid?')
        .when(sfn.Condition.booleanEquals('$.isValid', true), stepFindTemplate)
        .when(sfn.Condition.booleanEquals('$.isValid', false), stepMarkValidationFailed)
        .afterwards())

    stepMarkValidationFailed.next(stepUpdateRecordInDB).next(stepInformEmailNotSent)

    stepFindTemplate
      .next(new sfn.Choice(this, 'Does Template exist?')
        .when(sfn.Condition.isNotNull('$.template'), stepSendEmail)
        .when(sfn.Condition.isNull('$.template'), stepAddTemplates)
        .afterwards())

    stepAddTemplates
      .next(stepFindTemplateV2)
      .next(new sfn.Choice(this, 'Template created?')
        .when(sfn.Condition.isNotNull('$.template', true), stepSendEmail)
        .when(sfn.Condition.isNull('$.template'), stepMarkNoTemplate)
        .afterwards())

    stepMarkNoTemplate.next(stepUpdateRecordInDB)
    stepSendEmail.next(stepEmailSent)

    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(5)
    })

    const stepFunctionRole = new iam.Role(this, 'StepFunctionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    stateMachine.grantStartExecution(stepFunctionRole);
    stateMachine.grantRead(stepFunctionRole);
    stateMachine.grantTaskResponse(stepFunctionRole);
    stepFunctionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")
    )
    stepFunctionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy')
    );

    stepFunctionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
      resources: ['*'],
    }));

    // create a Lambda that will proxy list of SQS events to Step Function
    const lambdaSqsStepFunctionProxy = new lambda.Function(this, 'SqsStepFunctionProxy', {
      code: this.lambdaSqsStepFunctionProxyCode,
      handler: 'sqsstepfunc.handler',
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        TABLE_NAME: table.tableName,
        MAIN_QUEUE_URL: sqsMainQueue.queueUrl
      },
      environmentEncryption: kmsKey,
      retryAttempts: 0,
      role: stepFunctionRole,
      tracing: lambda.Tracing.ACTIVE,
      timeout: Duration.seconds(15),
    })

    sqsMainQueue.grantConsumeMessages(lambdaSqsStepFunctionProxy)
    sqsMainQueue.grantPurge(lambdaSingleRequest)
    lambdaSqsStepFunctionProxy.addEventSource(new lambdaevent.SqsEventSource(sqsMainQueue))
    table.grantReadWriteData(lambdaSqsStepFunctionProxy)

    const scheduleRole = new iam.Role(this, 'ScheduleExecutionRule', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    scheduleRole.addToPolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: [
        'lambda:InvokeFunction',
        'sts:AssumeRole',
        'sts:AssumeRoleWithSAML',
        'sts:AssumeRoleWithWebIdentity',
        'secretsmanager:*',
        'kms:DescribeKey',
        'kms:ListAliases',
        'kms:ListKeys',
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'xray:PutTraceSegments',
        'xray:PutTelemetryRecords',
      ],
    }));

    scheduleRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy')
    );

    const requestGeneratorRole = new iam.Role(this, 'RequestGeneratorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    requestGeneratorRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy')
    );

    const lambdaRequestGenerator = new lambda.Function(this, 'RequestGenerator', {
      code: this.lambdaSqsHandlerCode,
      handler: 'generator.generate',
      runtime: lambda.Runtime.NODEJS_10_X,
      tracing: lambda.Tracing.ACTIVE,
      role: requestGeneratorRole,
      layers: [layer],
      timeout: Duration.seconds(15),
    })

    const externalApi = new apigw.RestApi(this, "ExternalApiGenerator")
    const externalIntegration = new apigw.LambdaIntegration(lambdaRequestGenerator, {
      proxy: false,
      allowTestInvoke: true,
      integrationResponses: [
        {
          statusCode: "200",
          responseTemplates: {
            'application/json': `$input.json('$')`
          },
          responseParameters: {
            'method.response.header.Content-Type': "'application/json'",
          }
        }
      ]
    })
    externalApi.root
      .resourceForPath("external-api")
      .resourceForPath("generator")
      .addMethod("POST", externalIntegration, {
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Content-Type': true,
            }
          }
        ],
        apiKeyRequired: true,
      }
      )
    const externalDeployment = new apigw.Deployment(this, 'ExternalDeployment', {
      api: externalApi,
    });
    const externalProdStage = new apigw.Stage(this, 'MainExternalProd', {
      deployment: externalDeployment,
      stageName: 'PROD',
      tracingEnabled: true
    });

    const externalApiKey = externalApi.addApiKey('ExternalApiKey', {
      apiKeyName: 'externalApiKey',
      value: 'externalApiKey12345forSiarhei',
    })

    const externalPlan = api.addUsagePlan('ExternalUsagePlan', {
      name: 'ExternalUsagePlan',
      apiKey: externalApiKey,
      throttle: { rateLimit: 100, burstLimit: 100 },
      quota: { limit: 1000, period: apigw.Period.MONTH }
    })
    externalPlan.addApiStage({ stage: externalProdStage })

    const lambdaScheduledJob = new lambda.Function(this, 'ScheduledJob', {
      code: this.lambdaSqsHandlerCode,
      handler: 'scheduledlambda.handler',
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: {
        EXTERNAL_URL: 'https://vvcu6mhui5.execute-api.us-west-2.amazonaws.com/PROD/executeexternal',
        QUEUE_URL: sqsInputBuffer.queueUrl,
        EXTERNAL_ROLE_ARN: 'arn:aws:iam::923155431412:role/external-lambda-execxution-role',
        EXTERNAL_LAMBDA_NAME: 'lambdaExternalServiceFunction',
        SECRET_NAME: ''
      },
      role: scheduleRole,
      tracing: lambda.Tracing.ACTIVE,
      layers: [layer],
      timeout: Duration.seconds(15),
    })
    sqsInputBuffer.grantSendMessages(lambdaScheduledJob)

    const targetExecuteApi = new targets.LambdaFunction(lambdaScheduledJob, {
      event: events.RuleTargetInput.fromObject({ "execute": "api" })
    })

    const targetExecuteLambda = new targets.LambdaFunction(lambdaScheduledJob, {
      event: events.RuleTargetInput.fromObject({ "execute": "lambda" })
    })

    new events.Rule(this, 'RuleScheduleApi', {
      description: 'schedule call from api',
      enabled: true,
      schedule: events.Schedule.rate(Duration.minutes(5)),
      targets: [targetExecuteApi],
    });

    new events.Rule(this, 'RuleScheduleLambda', {
      description: 'schedule call from lambda',
      enabled: true,
      schedule: events.Schedule.cron({ minute: '10', hour: '0' }),
      targets: [targetExecuteLambda],
    });


    //MONITORING 
    const dashboard = new cloudwatch.Dashboard(this, 'CommonDashboard', { dashboardName: 'CommonDashboard' });
    const metricLambdaInvocations = new cloudwatch.Metric({
      metricName: 'Invocations',
      namespace: 'AWS/Lambda',
      statistic: 'average',
      period: Duration.minutes(30),
    });

    //Lambda monitoring 
    const metricLambdaDuration = new cloudwatch.Metric({
      metricName: 'Duration',
      namespace: 'AWS/Lambda',
      statistic: 'p95',
      period: Duration.minutes(30),
    });
    const metricLambdaErrors = new cloudwatch.Metric({
      metricName: 'Errors',
      namespace: 'AWS/Lambda',
      statistic: 'average',
      period: Duration.minutes(30),
    });

    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'Lambda Invocations',
      left: [metricLambdaInvocations, metricLambdaDuration],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));
    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'Lambda Duration',
      left: [metricLambdaDuration],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));
    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'Lambda Errors',
      left: [metricLambdaErrors],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));

    const metricLambdaInsights = new cloudwatch.Metric({
      metricName: 'used_memory_max',
      namespace: 'AWS/LambdaInsights',
      statistic: 'maximum',
      period: Duration.minutes(30),
      dimensions: {
        'FunctionName': lambdaSingleRequest.functionName
      },
    });

    const metricLambdaGeneratorInsights = new cloudwatch.Metric({
      metricName: 'used_memory_max',
      namespace: 'AWS/LambdaInsights',
      statistic: 'maximum',
      period: Duration.minutes(30),
      dimensions: {
        'FunctionName': lambdaRequestGenerator.functionName
      },
    });
    const metricLambdaSheduledInsights = new cloudwatch.Metric({
      metricName: 'used_memory_max',
      namespace: 'AWS/LambdaInsights',
      statistic: 'maximum',
      period: Duration.minutes(30),
      dimensions: {
        'FunctionName': lambdaScheduledJob.functionName
      },
    });
    
    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'Lambda Insights',
      left: [metricLambdaInsights, metricLambdaGeneratorInsights, metricLambdaSheduledInsights],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));

    //Api Gateway monitoring
    const metricApiGatewayTotalCalls = new cloudwatch.Metric({
      metricName: 'Count',
      namespace: 'AWS/ApiGateway',
      statistic: 'average',
      period: Duration.minutes(30),
      dimensions: {
        'ApiName': api.restApiName
      },
    });
    const metricExternalApiGatewayTotalCalls = new cloudwatch.Metric({
      metricName: 'Count',
      namespace: 'AWS/ApiGateway',
      statistic: 'average',
      period: Duration.minutes(30),
      dimensions: {
        'ApiName': externalApi.restApiName
      },
    });
    const metricApiGatewayLatency = new cloudwatch.Metric({
      metricName: 'Latency',
      namespace: 'AWS/ApiGateway',
      statistic: 'average',
      period: Duration.minutes(30),
      dimensions: {
        'ApiName': api.restApiName
      },
    });
    const metricExternalApiGatewayLatency = new cloudwatch.Metric({
      metricName: 'Latency',
      namespace: 'AWS/ApiGateway',
      statistic: 'average',
      period: Duration.minutes(30),
      dimensions: {
        'ApiName': externalApi.restApiName
      },
    });
    const metricApiGateway4XXError = new cloudwatch.Metric({
      metricName: '4XXError',
      namespace: 'AWS/ApiGateway',
      statistic: 'average',
      period: Duration.minutes(30),
      dimensions: {
        'ApiName': api.restApiName
      },
    });
    const metricExternalApiGateway4XXError = new cloudwatch.Metric({
      metricName: '4XXError',
      namespace: 'AWS/ApiGateway',
      statistic: 'average',
      period: Duration.minutes(30),
      dimensions: {
        'ApiName': externalApi.restApiName
      },
    });
    const metricApiGateway5XXError = new cloudwatch.Metric({
      metricName: '5XXError',
      namespace: 'AWS/ApiGateway',
      statistic: 'average',
      period: Duration.minutes(30),
      dimensions: {
        'ApiName': api.restApiName
      },
    });
    const metricExternalApiGateway5XXError = new cloudwatch.Metric({
      metricName: '5XXError',
      namespace: 'AWS/ApiGateway',
      statistic: 'average',
      period: Duration.minutes(30),
      dimensions: {
        'ApiName': externalApi.restApiName
      },
    });

    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'Api Gateway Total Calls',
      left: [metricApiGatewayTotalCalls, metricExternalApiGatewayTotalCalls],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));
    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'Api Gateway Latency',
      left: [metricApiGatewayLatency, metricExternalApiGatewayLatency],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));
    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'Api Gateway Errors',
      left: [metricApiGateway4XXError, metricExternalApiGateway4XXError, metricApiGateway5XXError, metricExternalApiGateway5XXError],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));

    //DynamoDB monitoring
    const metricDynamoDBReadCapacityUnits = new cloudwatch.Metric({
      metricName: 'ConsumedReadCapacityUnits',
      namespace: 'AWS/DynamoDB',
      dimensions: {
        'TableName': table.tableName
      },
      period: Duration.minutes(30),
    });
    const metricDynamoDBWriteCapacityUnits = new cloudwatch.Metric({
      metricName: 'ConsumedWriteCapacityUnits',
      namespace: 'AWS/DynamoDB',
      dimensions: {
        'TableName': table.tableName
      },
      period: Duration.minutes(30),
    });
    const metricDynamoDBSuccessfulRequestLatency = new cloudwatch.Metric({
      metricName: 'SuccessfulRequestLatency',
      namespace: 'AWS/DynamoDB',
      statistic: 'average',
      dimensions: {
        'TableName': table.tableName,
        'Operation': 'PutItem'
      },
      period: Duration.minutes(30),
    });
    const metricDynamoDBUserErrors = new cloudwatch.Metric({
      metricName: 'UserErrors',
      namespace: 'AWS/DynamoDB',
      period: Duration.minutes(30),
    });
    const metricDynamoDBSystemErrors = new cloudwatch.Metric({
      metricName: 'SystemErrors',
      namespace: 'AWS/DynamoDB',
      period: Duration.minutes(30),
    });
    const metricDynamoDBReadThrottleEvents = new cloudwatch.Metric({
      metricName: 'ReadThrottleEvents',
      namespace: 'AWS/DynamoDB',
      period: Duration.minutes(30),
      dimensions: {
        'TableName': table.tableName,
      },
    });
    const metricDynamoDBWriteThrottleEvents = new cloudwatch.Metric({
      metricName: 'WriteThrottleEvents',
      namespace: 'AWS/DynamoDB',
      period: Duration.minutes(30),
      dimensions: {
        'TableName': table.tableName,
      },
    });

    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'DynamoDB Read/Write Capacity Units',
      left: [metricDynamoDBReadCapacityUnits, metricDynamoDBWriteCapacityUnits],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));
    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'DynamoDB Request Latency',
      left: [metricDynamoDBSuccessfulRequestLatency],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));
    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'DynamoDB Errors',
      left: [metricDynamoDBUserErrors, metricDynamoDBSystemErrors],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));
    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'DynamoDB Read/Write Throttle Events ',
      left: [metricDynamoDBReadThrottleEvents, metricDynamoDBWriteThrottleEvents],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));

    //SQS monitoring
    const metricSQSNumberOfMessagesSentMain = new cloudwatch.Metric({
      metricName: 'NumberOfMessagesSent',
      namespace: 'AWS/SQS',
      dimensions: {
        'QueueName': sqsMainQueue.queueName,
      },
      period: Duration.minutes(30),
    });
    const metricSQSNumberOfMessagesSentInput = new cloudwatch.Metric({
      metricName: 'NumberOfMessagesSent',
      namespace: 'AWS/SQS',
      dimensions: {
        'QueueName': sqsInputBuffer.queueName,
      },
      period: Duration.minutes(30),
    });
    const metricSQSNumberOfMessagesSentDead = new cloudwatch.Metric({
      metricName: 'NumberOfMessagesSent',
      namespace: 'AWS/SQS',
      dimensions: {
        'QueueName': sqsInputBufferDeadLetter.queueName,
      },
      period: Duration.minutes(30),
    });
    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'SQS Number Of Messages Sent',
      left: [metricSQSNumberOfMessagesSentMain, metricSQSNumberOfMessagesSentInput, metricSQSNumberOfMessagesSentDead],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));

    const metricSQSSentMessageSizeMain = new cloudwatch.Metric({
      metricName: 'SentMessageSize',
      namespace: 'AWS/SQS',
      dimensions: {
        'QueueName': sqsMainQueue.queueName,
      },
      period: Duration.minutes(30),
    });
    const metricSQSSentMessageSizeInput = new cloudwatch.Metric({
      metricName: 'SentMessageSize',
      namespace: 'AWS/SQS',
      dimensions: {
        'QueueName': sqsInputBuffer.queueName,
      },
      period: Duration.minutes(30),
    });
    const metricSQSSentMessageSizeDead = new cloudwatch.Metric({
      metricName: 'SentMessageSize',
      namespace: 'AWS/SQS',
      dimensions: {
        'QueueName': sqsInputBufferDeadLetter.queueName,
      },
      period: Duration.minutes(30),
    });
    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'SQS Sent Message Size',
      left: [metricSQSSentMessageSizeMain, metricSQSSentMessageSizeInput, metricSQSSentMessageSizeDead],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));

    const metricSQSNumberOfMessagesReceivedMain = new cloudwatch.Metric({
      metricName: 'NumberOfMessagesReceived',
      namespace: 'AWS/SQS',
      statistic: 'average',
      dimensions: {
        'QueueName': sqsMainQueue.queueName,
      },
      period: Duration.minutes(30),
    });
    const metricSQSNumberOfMessagesReceivedInput = new cloudwatch.Metric({
      metricName: 'NumberOfMessagesReceived',
      namespace: 'AWS/SQS',
      statistic: 'average',
      dimensions: {
        'QueueName': sqsInputBuffer.queueName,
      },
      period: Duration.minutes(30),
    });
    const metricSQSNumberOfMessagesReceivedDead = new cloudwatch.Metric({
      metricName: 'NumberOfMessagesReceived',
      namespace: 'AWS/SQS',
      statistic: 'average',
      dimensions: {
        'QueueName': sqsInputBufferDeadLetter.queueName,
      },
      period: Duration.minutes(30),
    });
    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'SQS Number Of Messages Received',
      left: [metricSQSNumberOfMessagesReceivedMain, metricSQSNumberOfMessagesReceivedInput, metricSQSNumberOfMessagesReceivedDead],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));

    const metricSQSNumberOfEmptyReceivesMain = new cloudwatch.Metric({
      metricName: 'NumberOfEmptyReceives',
      namespace: 'AWS/SQS',
      statistic: 'average',
      dimensions: {
        'QueueName': sqsMainQueue.queueName,
      },
      period: Duration.minutes(30),
    });
    const metricSQSNumberOfEmptyReceivesInput = new cloudwatch.Metric({
      metricName: 'NumberOfEmptyReceives',
      namespace: 'AWS/SQS',
      statistic: 'average',
      dimensions: {
        'QueueName': sqsInputBuffer.queueName,
      },
      period: Duration.minutes(30),
    });
    const metricSQSNumberOfEmptyReceivesDead = new cloudwatch.Metric({
      metricName: 'NumberOfEmptyReceives',
      namespace: 'AWS/SQS',
      statistic: 'average',
      dimensions: {
        'QueueName': sqsInputBufferDeadLetter.queueName,
      },
      period: Duration.minutes(30),
    });
    dashboard.addWidgets(new cloudwatch.GraphWidget({
      title: 'SQS Number Of Empty Receives',
      left: [metricSQSNumberOfEmptyReceivesMain, metricSQSNumberOfEmptyReceivesInput, metricSQSNumberOfEmptyReceivesDead],
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    }));

    //alarms 
    const adminMailSubscription = new subs.EmailSubscription('Yana_Bahdanovich@epam.com');
    const topicLambdaErrors = new sns.Topic(this, 'LambdaErrorsTopic',  {
      displayName: 'Lambda Errors Topic',
      fifo: false
    });
    const topicDynamoDBErrors = new sns.Topic(this, 'DynamoDBErrorsTopic',  {
      displayName: 'DynamoDB Errors Topic',
      fifo: false
    });
    const topicApiGatewayErrors = new sns.Topic(this, 'ApiGatewayErrorsTopic',  {
      displayName: 'Api Gateway Errors Topic',
      fifo: false
    });
    topicLambdaErrors.addSubscription(adminMailSubscription);
    topicDynamoDBErrors.addSubscription(adminMailSubscription);
    topicApiGatewayErrors.addSubscription(adminMailSubscription);

    const metricLambdaErrorsFiveMins = new cloudwatch.Metric({
      metricName: 'Errors',
      namespace: 'AWS/Lambda',
      statistic: 'average',
      period: Duration.minutes(5),
    });

    const metricDynamoDBSystemErrorsFiveMins = new cloudwatch.Metric({
      metricName: 'SystemErrors',
      namespace: 'AWS/DynamoDB',
      period: Duration.minutes(5),
    });

    const metricApiGateway4XXErrorFiveMins = new cloudwatch.Metric({
      metricName: '4XXError',
      namespace: 'AWS/ApiGateway',
      statistic: 'average',
      period: Duration.minutes(5),
      dimensions: {
        'ApiName': api.restApiName
      },
    });

    const alarmLambdaErrors = new cloudwatch.Alarm(this, 'LambdaErrorsAlarm', {
      metric: metricLambdaErrorsFiveMins,
      threshold: 5,
      evaluationPeriods: 1,
    });
    alarmLambdaErrors.addAlarmAction(new cw_actions.SnsAction(topicLambdaErrors));

    const alarmDynamoDbErrors = new cloudwatch.Alarm(this, 'DynamoDBErrorsAlarm', {
      metric: metricDynamoDBSystemErrorsFiveMins,
      threshold: 5,
      evaluationPeriods: 1,
    }); 
    alarmDynamoDbErrors.addAlarmAction(new cw_actions.SnsAction(topicDynamoDBErrors));

    const alarmApiGatewayErrors = new cloudwatch.Alarm(this, 'ApiGatewayErrorsAlarm', {
      metric: metricApiGateway4XXErrorFiveMins,
      threshold: 5,
      evaluationPeriods: 1,
    });
    alarmApiGatewayErrors.addAlarmAction(new cw_actions.SnsAction(topicApiGatewayErrors));

   
  }

}