const AWSXRay = require('aws-xray-sdk');
const AWS = AWSXRay.captureAWS(require('aws-sdk'));

const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' }),
    sqs = new AWS.SQS({ apiVersion: '2012-11-05' }),
    kms = new AWS.KMS();


exports.handler = async function(event) {
    const tableName = await decrypt(process.env.TABLE_NAME);
    let data = {
        ...event,
        "status": "PENDING",
    };
    let response = {
        "headers": {
            "Content-Type": "application/json"
        },
        "isBase64Encoded": false
    };
    const record = await saveRecord(tableName, data);
    response.status = !!record.id ? 202 : 500;
    if (response.status == 202 ) {
        await sendRecordToSqs(JSON.stringify(record));
    }
    response.body = JSON.stringify(record);
    return response;
};

exports.authorizer = async function(event) {
    const header = event.headers.UserAgent,
        methodArn = event.methodArn;
    if (header === 'iOS') {
       return generateAuthResponse('user', 'Allow', methodArn);
    }
    return generateAuthResponse('user', 'Deny', methodArn);
};

async function decrypt(variable) {
    try {
        console.log('table ' + process.env.TABLE_NAME);
        console.log('FN ' + process.env.AWS_LAMBDA_FUNCTION_NAME);
        const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME,
            req = {
                CiphertextBlob: Buffer.from(variable, 'base64'),
                EncryptionContext: { LambdaFunctionName: functionName },
            };
        const data = await kms.decrypt(req).promise();
        return data.Plaintext.toString('ascii');
    } catch (err) {
        console.log('Decrypt error:', err);
        throw err;
    }
}

async function saveRecord(tableName, record) {
    let tableParams = {
        TableName : tableName,
        Item: record
    };
    let response;
    await dynamodb.put(tableParams)
    .promise()
    .then(data => {
        response = record;
    })
    .catch(err => {
       response = err;
    });
    return response;
};

async function sendRecordToSqs(message) {
    const queueUrl =  await decrypt(process.env.SEND_TO_SQS);
    let sqsParams = {
        MessageBody: message,
        QueueUrl: queueUrl,
        MessageGroupId: JSON.parse(message).type,
        MessageDeduplicationId: JSON.parse(message).id
    };
    console.log("sqs: " + JSON.stringify(sqsParams));
    await sqs.sendMessage(sqsParams, function(err, data) {
      if (err) {
        console.log("SQS Error ", err);
      } else {
        console.log("SQS Success ", data.MessageId);
      }
    }).promise();
};

function generateAuthResponse(principalId, effect, methodArn) {
    const policyDocument = generatePolicyDocument(effect, methodArn);
    return { principalId, policyDocument };
}

function generatePolicyDocument(effect, methodArn) {
    if (!effect || !methodArn) {
        return null;
    }
    return {
        Version: '2012-10-17',
        Statement: [{
            Action: 'execute-api:Invoke',
            Effect: effect,
            Resource: methodArn
        }]
    };
}