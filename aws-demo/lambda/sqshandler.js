const AWSXRay = require('aws-xray-sdk');
const AWS = AWSXRay.captureAWS(require('aws-sdk'));

const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' }),
    sqs = new AWS.SQS({apiVersion: '2012-11-05'}),
    kms = new AWS.KMS();

exports.handler = async function(event) {
    let requests = [];
    for(let { body } of event.Records) {
        let bodyObj = JSON.parse(body);
        console.log(body);
        let request = {
            ...JSON.parse(body),
            "status": "PENDING",
        };
        requests.push(request);
    }
    const tableName = await decrypt(process.env.TABLE_NAME),
        records = await saveRecords(tableName, requests);
    let status = !!records[0] != undefined && records[0].id ? 202 : 500;
    if (status == 202 ) {
        for(let record of records) {
            await sendRecordToSqs(JSON.stringify(record));
        }
    }
};

const decrypt = async (variable) => {
    try {
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
};

const saveRecords = async (tableName, records) => {
    let putRequests = [];
    for(let record of records) {
        putRequests.push({ PutRequest: { Item: record} });
    }
    var tableParams = {
        RequestItems: {
          [tableName]: putRequests
        }
    };
    console.log('tableParams: ' + JSON.stringify(tableParams))
    let response;
    await dynamodb.batchWrite(tableParams)
    .promise()
    .then(data => {
        console.log("Batch Success: " + JSON.stringify(data));
        response = records;
    })
    .catch(err => {
       console.log("Batch Error: " + err);
       response = err;
    });

    return response;
};

const sendRecordToSqs = async(message) => {
    const queueUrl = await decrypt(process.env.SEND_TO_SQS);
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
