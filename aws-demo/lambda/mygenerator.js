exports.generate = async (event) => {
    const defaultEmailSender = "yana.bogdanovich2000@mail.ru",
        defaultEmailRecipient = "Yana_Bahdanovich@epam.com";
    if (event.type === "timesheet") {
        var timesheetReports = [];
        for (let i = 1; i <= 20; i++) {
            timesheetReports.push({
                id: i,
                type: "timesheet",
                data: {
                    name: "Liam" + i, hoursMissed: getRandomInt(40)
                },
                metadata: {
                    emailSender: defaultEmailSender,
                    emailRecipient: defaultEmailRecipient,
                    subject: "Timesheet gaps"
                }
            })
        }
        return {
            statusCode: 200,
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(timesheetReports.filter(timesheetReport =>
                timesheetReport.data.hoursMissed > 0))
        };
    } else {
        throw("Unsupported type: " + event.type);
    }
};

function getRandomInt(max) {
    return Math.floor(Math.random() * Math.floor(max));
}
