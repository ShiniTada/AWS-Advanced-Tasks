const AWSXRay = require('aws-xray-sdk');
const AWS = AWSXRay.captureAWS(require('aws-sdk'));
const fetch = AWSXRay.captureHTTPsGlobal(require('node-fetch'));

const sqs = new AWS.SQS({apiVersion: '2012-11-05'}),
    sts = new AWS.STS({apiVersion: '2011-06-15'}),
    secretManager = new AWS.SecretsManager({region: 'us-east-1'});

const EXTERNAL_URL = process.env.EXTERNAL_URL,
    QUEUE_URL = process.env.QUEUE_URL,
    EXTERNAL_ROLE_ARN = process.env.EXTERNAL_ROLE_ARN,
    EXTERNAL_LAMBDA_NAME = process.env.EXTERNAL_LAMBDA_NAME,
    SECRET_NAME = process.env.SECRET_NAME;

let EXTERNAL_API_KEY, roleCreds, results;

exports.handler = async (event) => {

    //LAMBDA
    if (event.execute === "lambda") {
        const roleToAssume = {
            RoleArn: EXTERNAL_ROLE_ARN,
            RoleSessionName: 'session10',
            DurationSeconds: 1500,
        };
       await sts.assumeRole(roleToAssume, function (err, data) {
            if (err) {
                console.log("err: " + err);
            } else {
                roleCreds = {
                    accessKeyId: data.Credentials.AccessKeyId,
                    secretAccessKey: data.Credentials.SecretAccessKey,
                    sessionToken: data.Credentials.SessionToken
                };
                console.log("role creds: " + roleCreds);
                stsGetCallerIdentity(roleCreds);
            }
        }).promise();

        const lambda = new AWS.Lambda({
            // region: 'us-east-1',
           region: 'us-west-2',
            accessKeyId: roleCreds.accessKeyId,
            secretAccessKey: roleCreds.secretAccessKey,
            sessionToken: roleCreds.sessionToken
        });

        const params = {
            FunctionName: EXTERNAL_LAMBDA_NAME,
            Payload: JSON.stringify({type: 'timesheet'})
        };

        await lambda.invoke(params, function (err, data) {
            if (err) {
                console.log("err: " + err);
            } else {
                let payload =  JSON.parse(data.Payload);
                results = JSON.parse(payload.body);
                console.log("labmda data: " + results);
            }
        }).promise();
    }


    //API
    if (event.execute === "api") {
        await secretManager.getSecretValue({SecretId: SECRET_NAME}, function (err, data) {
            if (err) {
                if (err.code === 'ResourceNotFoundException')
                    console.log("The requested secret x-api-key was not found");
                else if (err.code === 'InvalidRequestException')
                    console.log("The request was invalid due to: " + err.message);
                else if (err.code === 'InvalidParameterException')
                    console.log("The request had invalid params: " + err.message);
            } else {
                console.log(data);
                if (data.SecretString !== "") {
                    EXTERNAL_API_KEY = JSON.parse(data.SecretString)['x-api-key'];
                }
            }
        }).promise();

        console.log(EXTERNAL_API_KEY);

        let bodyRequest = {
            type: 'timesheet'
        };

        await fetch(EXTERNAL_URL, {
            method: 'POST',
            headers: {'x-api-key': EXTERNAL_API_KEY},
            body: JSON.stringify(bodyRequest)
        }).then(res => res.json())
        .then(json => {
            results = JSON.parse(json.body);
            console.log(results);
        });
    }

    //send messages
    for(let entry of results) {
        entry.id = entry.id + '';
        let messageGroup = event.execute + entry.id;
        let sqsParams = { 
            MessageBody: JSON.stringify(entry), 
            QueueUrl: QUEUE_URL,
            MessageGroupId: messageGroup,
            MessageDeduplicationId: messageGroup
        };
        console.log("send message params: " + JSON.stringify(sqsParams));

        await sqs.sendMessage(sqsParams, function (err, data) {
            if (err) { 
                console.log("err: " + err); 
            } else {
                console.log(data);
            }
        }).promise();
    }

    return {
        statusCode: 200
    };

};

//Get Arn of current identity
async function stsGetCallerIdentity(creds) {
    var stsParams = {credentials: creds};
    // Create STS service object
    var sts = new AWS.STS(stsParams);

    sts.getCallerIdentity({}, function (err, data) {
        if (err) {
            console.log(err, err.stack);
        } else {
            console.log(data.Arn);
        }
    }).promise();
}
