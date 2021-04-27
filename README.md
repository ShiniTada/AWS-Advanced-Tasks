# AWS-Advanced-Tasks
AWS Advanced Mentoring Program #1

Work with AWS CDK 

# 1.Deployment setup
- Create Git repository which will be used for storing your application and infrastructure code within the program. Consider one of the following options: 
- AWS CodeCommit (preferable) - create Git repository in your AWS account.  
- Create a simple Lambda function. There are no specific requirements for this Lambda, all that required for now is just to have the ability to receive some payload and return "Success" in the response body. You can use any language you prefer for Lambda function implementation. 
- Create a deployment pipeline that will listen for any updates in the connected repository and automatically start build and deployment process of the code and infrastructure changes. Pipeline should consist of the following stages: 
    Source - fetches the source of the application from your repository and triggers the pipeline every time you push new commits to it. 
    Build - builds the code of Lambda function and prepares a change set for infrastructure update. 
    Deploy - applies infrastructure changes and updates Lambda function with artifact from the previous step.


# 2. API Gateway & its access control
Goal: create a REST API via API Gateway over a Lambda from previous reading the input information to trigger email notification and sending the report about the number of bytes consumed and successful status of process initiation (202 Accepted); add some access control features.
What to do:
- Update the Lambda from the previous task to return 202 status code and the submitted JSON from its input in case of success. 
- Update your stack to add definition of API Gateway resource with Lambda integration (over the Lambda created in a previous module). NOTE: don’t use Proxy integration.
- Update the output model of the API to return 202 Accepted code if Lambda returns success, and the input payload size in bytes as a response body instead of the submitted JSON itself (without any updates in Lambda code). 
- Add the request body model and basic request body validation for the resource. 
- Deploy the endpoint to the “PROD” stage. 
- Let’s consider that you need to provide the API access to, for example, iOS clients which because of some reason are the only users allowed to call the API even with the API keys (like platinum partners). 
- Create a Lambda Request authorizer with 3 minutes cache, that validates the “User-Agent” header and allows access only to the clients with the expected “iOS” header (the header value must be read from the properties in order to secure it in future modules). 
- Attach the authorizer to the created API and check that the header is handled properly.


# 3. DynamoDB
- Identify data model (you can use related section in Intro module: In subsequent modules there will be more interactions with DynamoDB) 
- Identify main operations (component diagram from Intro), select appropriate primary/partition key and design table structure 
- Create DynamoDB table for email events
- Add required permissions to invoke from ApiEventHandler lambda 
- Implement event saving. In order to track event state, additional field status can be introduced (PENDING,  .. , SENT) 

# 4. SES/SQS
- Create SQS queue which will play the role of the input buffer. 
Introduce a new SQSEventHandler Lambda function which will be responsible for pulling events from the input SQS queue and storing them into the DynamoDB table. 
- Create a separate dead-letter SQS queue and configure redrive policy to move messages from the input queue to the dead-letter queue if maxReceiveCount for the message exceeds some limit. 
- Create main SQS queue to hold events for further processing. 
- Modify both ApiEventHandler and SQSEventHandler Lambda functions to send events to the main queue. 
- Add and verify sender and receiver email addresses. We'll use them in the subsequent module. 


# 5. AWS Step Functions
Currently, there is no way to invoke Step Function directly from AWS SQS. That’s why we can implement a proxy Lambda function that will be subscribed on SQS events, read them and resend events to Step Function. 
In the scope of the sub task, you need:
- create a Lambda that will proxy list of SQS events to Step Function. 
- Setup S3 Bucket within your Stack to store email templates 
- Put some templates that will be used in the flow into the created S3 bucket 
- Create a Lambda function that will accept input event and validate it.
- Create a Lambda function that will accept template name/id and will return this template from S3 bucket.   
- Think about error handling in case of template absence. 
- Create a Lambda function that will accept data for email and send this email using AWS SES. 
- Create Step Functions to orchestrate the flow.


# 6. Security advanced (AWS KMS, AWS Secrets Manager)
- Add your own custom managed key (CMK). Remember about the pricing per key, so try to create it once via CDK and not to re-create to save money. 
- Add Server-Side Encryption to the previously added services that support this (DynamoDB, S3, SQS) using the key created in the previous task. 
- Encrypt all environment variables used in your Lambda functions with your CMK and decrypt them inside the Lambda code. 
- The run has already prepared external service with credentials that should be used for access to it. Store them in Secret Manager and deploy the lambda in your account. 
- Add a scheduled Lambda function to read the stored secret and use it to read the incoming requests from the external service and send them to the Event Batch input SQS from module 5 as a batch. 
- The external service has a Lambda under the API, so try to invoke this Lambda from external AWS account directly (using the AWS Security Token Service).


# 7. Distributed tracing and monitoring
- Enable X-Ray tracing for all Lambda functions, enable X-Ray tracing for API Gateway 
- Instrument AWS SDK code within Lambda functions so that all calls to AWS services are traced 
- Instrument http client that is used within Scheduled Job Lambda function using AWS X-Ray SDK 
- Add 5 widgets to track Lambda functions metrics
- Add 4 widgets to track API Gateway metrics 
- Add 4 widgets to track DynamoDB metrics
- Add 4 widgets to track SQS metrics. Each widget must contain metrics for all used SQS.
