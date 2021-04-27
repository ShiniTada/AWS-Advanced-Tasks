const AWSXRay = require('aws-xray-sdk');
const AWS = AWSXRay.captureAWS(require('aws-sdk'));

const sqs = new AWS.SQS({apiVersion: '2012-11-05'}),
    kms = new AWS.KMS(),
    stepfunctions = new AWS.StepFunctions();

exports.handler = async function(event, context, callback) {
    if (event.Records.length < 0) {
        console.log('there is no any record in request.');
        return;
    }
    const mainQueueUrl = await decrypt(process.env.MAIN_QUEUE_URL),
        machineArn = await decrypt(process.env.STATE_MACHINE_ARN);
    for (let i = 0; i < event.Records.length; i++) {
        let message = event.Records[i];
        console.log("message: " + JSON.stringify(message));
        let record = JSON.parse(message.body); 
        await deleteMessagesFromSQS(mainQueueUrl, message.receiptHandle);

        let sfParams = {
            stateMachineArn: machineArn,
            input: JSON.stringify({ record })
        };
        await stepfunctions.startExecution(sfParams).promise().then(() => {
            callback(null, `State machine ${sfParams.stateMachineArn} executed successfuly`);
        }).catch(err => {
            callback(err.mesage);
        });
    }
};

async function decrypt(variable) {
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

async function deleteMessagesFromSQS(queueUrl, receiptHandle) {
    const deleteParams = {
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle
    };
    await sqs.deleteMessage(deleteParams, function(err, data) {
        if (err) {
            console.log(err);
        } else {
            console.log(JSON.stringify(data));
        }
    }).promise();
}