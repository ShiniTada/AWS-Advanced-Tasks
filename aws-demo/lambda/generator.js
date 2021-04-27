exports.generate = async (event) => {
    const defaultEmail = "sergei.golovach.aws@gmail.com";
    if (event.type === "timesheet") {
        var timesheetReports = [
            {
                type: "timesheet",
                data: {
                    id: "1", name: "Liam", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "2", name: "Olivia", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "3", name: "Noah", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "4", name: "Emma", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "2", name: "Oliver", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "6", name: "Ava", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "7", name: "William", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "8", name: "Sophia", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "9", name: "Elijah", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "10", name: "Isabella", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "11", name: "James", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "12", name: "Charlotte", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "13", name: "Benjamin", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "14", name: "Amelia", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "15", name: "Lucas", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "16", name: "Mia", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "17", name: "Mason", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "18", name: "Harper", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "19", name: "Ethan", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            },
            {
                type: "timesheet",
                data: {
                    id: "20", name: "Evelyn", email: defaultEmail, hoursMissed:
                        getRandomInt(40)
                },
                metadata: {
                    emailRecipients: ["sergei.golovach.aws@gmail.com"],
                    subject: "Timesheet"
                }
            }
        ];
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
