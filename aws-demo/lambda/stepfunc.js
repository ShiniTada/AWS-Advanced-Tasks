const AWSXRay = require('aws-xray-sdk');
const AWS = AWSXRay.captureAWS(require('aws-sdk'));

const s3 = new AWS.S3({apiVersion: '2006-03-01'}),
    dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' }),
    ses = new AWS.SES(),
    kms = new AWS.KMS();

const EmailTypes = { TIMESHEET: 'timesheet', FEEDBACK: 'feedback' },
    Templates = { 
    feedback: `Dear {name},
    Please finalize your feedback and mark the interview as complete.
    Candidate: {candidate}
    Date/Time: {dateTime}
    Interview type: {interviewType}
    Thank you in advance!
    This email was generated automatically. Please don't reply.`,
    timesheet: `Dear {name},
    Kindly remind you that all hours should be reported by you according to the actual hours performed. For now, there are some gaps in your Time Journal for the current week. Missed hours: {hoursMissed}.
    This email was generated automatically. Please don't reply.`
};

exports.addTemplates = async function(event) {
    const bucketName = await decrypt(process.env.BUCKET_NAME);
    for(let emailCode in EmailTypes) {
        let type = EmailTypes[emailCode];
        if (!!Templates[type]) {
            await uploadToS3(bucketName, Templates[type], type + '.txt');
        }
    }
    return { record: event.record };
};

exports.findTemplate = async function(event) {
    const bucketName = await decrypt(process.env.BUCKET_NAME);
    const record = event.record;
    const recordParams = {
        Bucket: bucketName,
        Key: `${record.type}.txt`
    },
    bucketParams = {
        Bucket : bucketName,
    };
    let templates;
    await s3.listObjects(bucketParams, function(err, data) {
        if (err) {
            console.log("Error", err);
        } else {
            console.log("Success", data);
            templates = data;
        }
    }).promise();
    if (templates.Contents.filter(obj => obj.Key == recordParams.Key).length == 0) {
        return { template: null, record };
    }
    let response;
    await s3.getObject(recordParams, function(err, data) {
        if (err) {
            console.log('err: ' + err);
        } else {
            let template = data.Body.toString('utf-8');
            console.log(template);
            response = { record, template };
        }
    }).promise(); 
    return response;
};

exports.validateMessageData = async function(event) {
    let record = event.record;
    if(!record) {
        console.log('There is no any record in request.');
        return { isValid: false, record };
    }
    let response = { isValid: true, record };
    console.log('type:  ' + record.type);
    switch (record.type) {
        case EmailTypes.TIMESHEET:
            response.isValid = validateTimesheet(record);
            break;
        case EmailTypes.FEEDBACK:
            response.isValid = validateFeedback(record);
            break;
        default:
            console.log(`unknown request type ${record.type}.`);
            response.isValid = true;
        }
    console.log('success resp: ' + JSON.stringify(response));
    return response;
};

exports.updateRecordInDB = async function(event) {
    const tableName = await decrypt(process.env.TABLE_NAME);
    if (!!event.needToUpdate && !!event.needToUpdate.status) {
        return await updateRecord(tableName, event.record, event.needToUpdate.status);
    }
};

exports.sendEmail = async function(event, context, callback) {
    let record = event.record,
        template = event.template,
        message = '';
    switch (record.type) {
        case EmailTypes.TIMESHEET:
            let nameToReplace = /{name}/gi,
                hoursMissed = /{hoursMissed}/gi;
            message = template.replace(nameToReplace, record.data.name);
            message = message.replace(hoursMissed, record.data.hoursMissed);
            break;
        case EmailTypes.FEEDBACK:
                let fNameToReplace = /{name}/gi,
                    fCandidate = /{candidate}/gi,
                    fDateTime = /{dateTime}/gi,
                    fInterviewType = /{interviewType}/gi;
                message = template.replace(fNameToReplace, record.data.name);
                message = message.replace(fCandidate, record.data.candidate);
                message = message.replace(fDateTime, record.data.dateTime);
                message = message.replace(fInterviewType, record.data.interviewType);
            break;
    }
    console.log(message);
    let params = {
        Destination: {
          ToAddresses: [record.metadata.emailRecipient],
        },
        Message: {
          Body: {
            Text: { Data: message },
          },
          Subject: { Data: record.metadata.subject },
        },
        Source: record.metadata.emailSender,
    };
    const tableName = await decrypt(process.env.TABLE_NAME);
    await ses.sendEmail(params).promise()
    .then(async data => {
        await updateRecord(tableName, event.record, 'SEND_SUCCESS');
        callback(null, 'Message sent successfully. ' + JSON.stringify(data));
    }).catch(err => {
        callback(err.mesage);
    });
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

async function uploadToS3(bucketName, templateBody, fileNameInS3) {
    const params = {
        Bucket: bucketName,
        Key: fileNameInS3,
        Body: templateBody
   };
    await s3.upload(params, function(err, data) {
        if (err) {
            console.log(`err: ${err}`);
            throw err;
        }
        console.log(`File uploaded successfully. ${data.Location}`);
    }).promise();
}

function validateTimesheet(record) {
    let requiredFileds = ['name', 'hoursMissed'];
    for(let field of requiredFileds) {
        if (!(field in record.data) || (field == 'hoursMissed' && record.data.hoursMissed <= 0)) {
            console.log(`\'${field}\' property is required.`);
            return false;
        }
    }
    return true;
}

function validateFeedback(record) {
    let requiredFileds = ['name', 'candidate', 'dateTime', 'interviewType'];
    for(let field of requiredFileds) {
        if (!(field in record.data)) {
            console.log(`\'${field}\' property is required.`);
            return false;
        }
    }
    return true;
}

async function updateRecord(tableName, record, status) {
    let item = record;
    item.status = status;
    console.log(JSON.stringify(item));
    let tableParams = {
        TableName : tableName,
        Item: item
    };
    await dynamodb.put(tableParams)
    .promise()
    .then(data => {
       console.log(data);
    })
    .catch(err => {
       console.log(err);
    });
    return item;
}