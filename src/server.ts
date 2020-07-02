import path from "path";
import dotenv from "dotenv";
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import jwt_decode from "jwt-decode";

dotenv.config();

const app = express();
app.use(bodyParser.json());
const port = process.env.PORT || 5000;
const accountId = <string>process.env.ACCOUNT_ID;
const username = <string>process.env.USERNAME;
const password = <string>process.env.PASSWORD;
const voiceApplicationPhoneNumber = <string>process.env.VOICE_APPLICATION_PHONE_NUMBER;

const callControlUrl = `${process.env.BANDWIDTH_WEBRTC_CALL_CONTROL_URL}/accounts/${accountId}`;
const sipxNumber = <string>process.env.BANDWIDTH_WEBRTC_SIPX_PHONE_NUMBER;

// Check to make sure required environment variables are set
if (!accountId || !username || !password) {
  console.error(
    "ERROR! Please set the ACCOUNT_ID, USERNAME, and PASSWORD environment variables before running this app"
  );
  process.exit(1);
}

interface Participant {
  id: string;
  token: string;
}

let sessionId: string;

/////////////////////////////////////////////////////////////////////////////
//                                                                         //
// REST API Config                                                        //
//                                                                         //
// These endpoints handle requests from the browser to get connection      //
// info and requests from the Voice API to handle incoming phone calls     //
//                                                                         //
/////////////////////////////////////////////////////////////////////////////

/**
 * The browser will hit this endpoint to get a session and participant ID
 */
app.get("/connectionInfo", async (req, res) => {
  const { id, token } = await createParticipant("hello-world-browser");
  res.send({
    token: token,
    voiceApplicationPhoneNumber: voiceApplicationPhoneNumber,
  });
});

/**
 * Bandwidth's Voice API will hit this endpoint when we receive and incoming call
 */
app.post("/incomingCall", async (req, res) => {
  const callId = req.body.callId;
  const from = req.body.from;
  console.log(`received incoming call ${callId} from ${from}`);
  const { id, token } = await createParticipant("hello-world-phone");

  // This is the response payload that we will send back to the Voice API to transfer the call into the WebRTC session
  const bxml = `<?xml version="1.0" encoding="UTF-8" ?>
  <Response>
      ${await generateTransferBxml(token)}
  </Response>`;

  // Send the payload back to the Voice API
  res.contentType("application/xml").send(bxml);
  console.log(`transferring ${callId} to session ${sessionId} as participant ${id}`);
});

app.post("/callStatus", async (req, res) => {
  console.log("received status update", req.body);
});

// These two lines set up static file serving for the React frontend
app.use(express.static(path.join(__dirname, "..", "frontend", "build")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "build", "index.html"));
});
app.listen(port, () => console.log(`WebRTC Hello World listening on port ${port}!`));

/////////////////////////////////////////////////////////////////////////////
//                                                                         //
// Bandwidth WebRTC Functions                                              //
//                                                                         //
// The following few functions make requests to the WebRTC Service to      //
// create sessions and participants. They also help manage the app's       //
// local state map of who all is in the session                            //
//                                                                         //
/////////////////////////////////////////////////////////////////////////////

/**
 * Get a new or existing WebRTC session ID
 */
const getSessionId = async (): Promise<string> => {
  // If we already have a valid session going, just re-use that one
  if (sessionId) {
    try {
      await axios.get(`${callControlUrl}/sessions/${sessionId}`, {
        auth: {
          username: username,
          password: password,
        },
      });
      return sessionId;
    } catch (e) {
      console.log(`session ${sessionId} is invalid`);
    }
  }

  // Otherwise start a new one and return the ID
  let response = await axios.post(
    `${callControlUrl}/sessions`,
    {
      tag: "hello-world",
    },
    {
      auth: {
        username: username,
        password: password,
      },
    }
  );
  sessionId = response.data.id;
  console.log(`created new session ${sessionId}`);
  return sessionId;
};

/**
 * Create a new participant and save their ID to our app's state map
 */
const createParticipant = async (tag: string): Promise<Participant> => {
  // Create a new participant
  let createParticipantResponse = await axios.post(
    `${callControlUrl}/participants`,
    {
      callbackUrl: "https://example.com",
      publishPermissions: ["AUDIO"],
      tag: tag,
    },
    {
      auth: {
        username: username,
        password: password,
      },
    }
  );

  const participant = createParticipantResponse.data.participant;
  const token = createParticipantResponse.data.token;
  const participantId = participant.id;
  console.log(`created new participant ${participantId}`);

  // Add participant to session
  const sessionId = await getSessionId();
  await axios.put(
    `${callControlUrl}/sessions/${sessionId}/participants/${participant.id}`,
    {
      sessionId: sessionId,
    },
    {
      auth: {
        username: username,
        password: password,
      },
    }
  );

  return {
    id: participantId,
    token: token,
  };
};

/**
 * Helper method to generate transfer BXML from a WebRTC device token
 * @param deviceToken device token received from the call control API for a participant
 */
const generateTransferBxml = async (deviceToken: string) => {
  //Get the tid out of the participant jwt
  var decoded: any = jwt_decode(deviceToken);
  return `<Transfer transferCallerId="${decoded.tid}"><PhoneNumber>${sipxNumber}</PhoneNumber></Transfer>`;
};
