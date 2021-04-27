!! change region to US East (N. Virginia) us-east-1

do the following:
cdk bootstrap
cdk deploy PipelineDeployingLambdaStack

1. encrypt lambda variables through aws cli
2. add in secretsManager secret x-api-key value of remote service

add your mails to SES

in Postman:

1. create POST method
2. copy api url from cloudFormation LambdaDeploymentStack Output + /api/notifications
3. choose request body example in /email/examples and put in request body
4. add request header:
   x-api-key : apikey12345usedForSilverUsagePlan
   UserAgent : iOS
   OR
   x-api-key : apikey6789usedForGoldUsagePlan
   UserAgent : iOS

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template
