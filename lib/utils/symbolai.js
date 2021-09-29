const assert = require('assert');
const bent = require('bent');
const Emitter = require('events');
const WebSocketClient = require('websocket').client;
const {greeting, abilities} = require('./constants');

assert.ok(process.env.SYMBOLAI_BASE_URL, 'You must define the SYMBOLAI_BASE_URL env variable');
assert.ok(process.env.SYMBOLAI_APP_ID, 'You must define the SYMBOLAI_APP_ID env variable');
assert.ok(process.env.SYMBOLAI_APP_SECRET, 'You must define the SYMBOLAI_APP_SECRET env variable');

const QS_ASKED_TO_JOIN = 'asked to join';
const QS_ASKED_QUESTION = 'asked question';
const QS_IDLE = 'idle';

class Symbolai extends Emitter {
  constructor(logger, app) {
    super();

    this.logger = logger;
    const members = (app.locals.members || []);
    this.roster = members.map((m) => m.hints).flat();
    this.client = app.locals.client;
    this.wsc = new WebSocketClient();
    this.postJSON = bent(process.env.SYMBOLAI_BASE_URL, 'POST', 'json', 200);
    this.members = new Map(members.map((m) => [m.tn, {name: m.name, hints: m.hints, tn: m.tn, state: QS_IDLE}]));
  }

  findMemberByName(name) {
    const allMembers = Array.from(this.members);
    const found = allMembers.find((el) => el[1].hints.includes(name.toLowerCase()));
    if (found) return found[1];
  }

  /**
   * generate auth token and connect via websocket to Symbol.ai
   */
  async connect(callSid) {
    try {
      assert.ok(!this.client_connection, 'can not call connect twice');
      this.callSid = callSid;

      /* announce myself */
      this.say(greeting);
      const response = await this.postJSON('oauth2/token:generate', {
        type: 'application',
        appId: process.env.SYMBOLAI_APP_ID,
        appSecret: process.env.SYMBOLAI_APP_SECRET
      });
      const wsUrl = `wss://${process.env.SYMBOLAI_BASE_URL.slice(8)}v1/realtime/insights/${callSid}`;
      this.logger.debug({response, wsUrl}, 'response from oauth2 call');
      this.wsc.connect(wsUrl, null, null, { 'X-API-KEY': response.accessToken});
    } catch (err) {
      this.logger.error({err}, 'Error contacting symbolai');
      return false;
    }

    this.wsc.on('connectFailed', (err) => {
      this.logger.error(err, 'failed to connect to Symbol.ai');
      this.emit('connectFailed', err);
    });
    this.wsc.on('connect', (conn) => {
      this.logger.debug('successfully connected to symbold');
      this.client_connection = conn;
      this._initConversation();
      this.emit('connect');
      conn
        .on('close', () => {
          this.logger.info('WebSocket closed from Symbol.ai.');
          this.emit('close');
          this.client_connection = null;
        })
        .on('error', (err) => {
          this.logger.error({err}, 'Symbol.ai WebSocket error');
          this.emit('error', err);
        })
        .on('message', (data) => {
          if (data.type === 'utf8') {
            const { utf8Data } = data;
            this.processSymblaiData(utf8Data);
          }
        });
    });

    return true;
  }

  _initConversation(conn) {
    this.client_connection.send(JSON.stringify({
      type: 'start_request',
      insightTypes: ['question', 'action_item'],
      trackers: this._makeTrackers(),
      config: {
        confidenceThreshold: 0.5,
        timezoneOffset: 240, // Your timezone offset from UTC in minutes
        languageCode: 'en-US',
        speechRecognition: {
          encoding: 'LINEAR16',
          sampleRateHertz: 8000
        },
        meetingTitle: 'Jitsi meeting'
      },
      speaker: {
        userId: 'daveh@drachtio.org',
        name: 'daveh'
      },
    }));
  }

  _makeTrackers() {
    const trackers =  {
      name: 'Roster',
      vocabulary: this.roster
    };
    this.logger.debug({trackers, roster: this.roster}, 'trackers');
    return trackers;
  }

  close() {
    if (this.client_connection) {
      this.client_connection.send(JSON.stringify({type: 'stop_request'}));
      this.client_connection = null;
      this.emit('close');
    }
  }

  sendAudio(buf) {
    this.client_connection && this.client_connection.send(buf);
  }

  processSymblaiData(data) {
    try {
      const obj = JSON.parse(data);
      this.logger.debug({obj}, this.processSymblaiData);
      if (obj.type === 'message_response') {
        const text = obj.messages
          .filter((m) => m.payload.contentType === 'text/plain')
          .map((m) => m.payload.content)
          .join(' ');
        this.logger.info(`got message: ${text}`);
      }
      else if (obj.type === 'message' && obj.message.type === 'recognition_result' && obj.message.isFinal) {
        const transcript = obj.message.payload.raw.alternatives[0].transcript;
        this.logger.info(`got final transcript: ${transcript}`);

        const join = /Xfinity.*[Aa]sk ([a-zA-Z]*)[\s|\?|,|\.]+to join/.exec(transcript);
        if (join) return this.doJoin(join[1]);

        const question = /Xfinity.*([Aa]sk|[Tt]ell)[\s|\?|,|\.]+([a-zA-Z]*)[\s|\?|,|\.](.*)$/.exec(transcript);
        if (question) return this.doQuestion(question[1], question[2], question[3]);

        const repeat = /Xfinity.*(repeat that|say that again)/.exec(transcript);
        if (repeat) return this.doRepeat();

        const capabilities = /Xfinity[\s|,]*what can you do/.exec(transcript);
        if (capabilities) return this.say(abilities);
      }
    } catch (err) {
      this.logger.error(err, `Error parsing message ${data}`);
    }
  }

  processIncomingSMS(tel, message) {
    const tn = tel.startsWith('+') ? tel.slice(1) : tel;
    const member = this.members.get(tn);
    if (member) {
      if (member.state === QS_ASKED_TO_JOIN) {
        this.logger.info({member}, `response to join request: ${message}`);
        const text = message.toLowerCase();
        if ('y' === text || 'yes' === text) {
          this.say(`OK, I am connecting ${member.name} to the call now`);
        }
        else if ('n' === text || 'no' === text) {
          this.say(`Sorry, ${member.name} can't join the call right now`);
        }
        else {
          this.say(`So ${member.name} can't join the call right now.  He said: ${message}`);
        }
      }
      else {
        this.say(`So ${member.name} said: ${message}`);
      }
      member.state = QS_IDLE;
    }
    else {
      this.logger.info(`discarding incoming SMS to unknown tn ${tel}`);
    }
  }

  async say(text) {
    try {
      await this.client.calls.update(this.callSid, {
        whisper: {verb: 'say', text}
      });
    } catch (err) {
      this.logger.error({err}, 'Error performing Live Call Control');
    }
  }

  doJoin(name) {
    const member = this.findMemberByName(name);
    if (member) {
      this.say(`Sure, I will check to see if ${member.name} can join the call`);
      this.askToJoin(member);
    }
    else {
      this.say(`I'm sorry, I don't know anyone named ${name}`);
    }
  }

  doQuestion(type, name, question) {
    const member = this.findMemberByName(name);
    if (member) {
      const verb = type.toLowerCase() === 'tell' ? 'said ' : 'asked ';
      const verb2 = type.toLowerCase() === 'tell' ? 'tell ' : 'ask ';

      this.say(`Sure, I will ${verb2} ${member.name}: ${question}`);
      this.askQuestion(verb, member, question);
    }
    else {
      this.say(`I'm sorry, I don't know anyone named ${name}`);
    }
  }

  doRepeat() {
  }

  async askToJoin(member) {
    // eslint-disable-next-line max-len
    const text = `Hey ${member.name}, the folks asked if you could join the call. Text Y to join or N to decline. Or tap out a response and I will relay it to the group.`;
    try {
      member.state = QS_ASKED_TO_JOIN;
      const response = await this.client.messages.create({
        from: process.env.SMS_SENDING_NUMBER,
        to: member.tn,
        text
      });
      this.logger.info({response}, 'askToJoin: sent SMS');
    } catch (err) {
      member.state = QS_IDLE;
      this.logger.error({err}, 'Error sending SMS');
    }
  }

  async askQuestion(verb, member, question) {
    const text = `Hey ${member.name}, the folks ${verb}: ${question}`;
    try {
      member.state = QS_ASKED_QUESTION;
      const response = await this.client.messages.create({
        from: process.env.SMS_SENDING_NUMBER,
        to: member.tn,
        text
      });
      this.logger.info({response}, 'askQuestion: sent SMS');
    } catch (err) {
      member.state = QS_IDLE;
      this.logger.error({err}, 'Error sending SMS');
    }
  }

}

module.exports = Symbolai;
