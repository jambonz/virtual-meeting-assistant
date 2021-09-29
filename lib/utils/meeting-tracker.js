const assert = require('assert');

class MeetingTracker {
  constructor(logger) {
    this.logger = logger;
    this.meetings = new Map();
  }

  add(symbolai) {
    const {callSid} = symbolai;

    assert(symbolai.callSid);

    this.meetings.set(callSid, symbolai);
    symbolai.on('close', () => this.meetings.delete(callSid));
  }

  find(tel) {
    const tn = tel.startsWith('+') ? tel.slice(1) : tel;
    const allMeetings = Array.from(this.meetings);
    const meeting = allMeetings.find((m) => m[1].members.has(tn));
    if (meeting) {
      this.logger.debug(`MeetingTracker: found meeting for tn ${tn}`);
      return meeting[1];
    }
    else this.logger.debug(`MeetingTracker: did not find meeting for tn ${tn}`);
  }
}

/* singleton */
let meetingTracker;

module.exports = (logger) => {
  if (!meetingTracker) meetingTracker = new MeetingTracker(logger);
  return meetingTracker;
};
