import path from "path";
import dotenv from "dotenv";
import express from "express";
import bodyParser from "body-parser";
import BandwidthRtc, { ParticipantLeftEvent } from "@bandwidth/webrtc-node-sdk";

dotenv.config();

const bandwidthRtc = new BandwidthRtc();
const app = express();
app.use(bodyParser.json());
const port = process.env.PORT || 5000;
const accountId = process.env.ACCOUNT_ID;
const username = process.env.USERNAME;
const password = process.env.PASSWORD;
const phoneNumber = process.env.PHONE_NUMBER;
const participantStreams: Map<string, string[]> = new Map();

// Check to make sure required environment variables are set
if (!accountId || !username || !password) {
  console.error(
    "ERROR! Please set the ACCOUNT_ID, USERNAME, and PASSWORD environment variables before running this app"
  );
  process.exit(1);
}

let conferenceId: string;

/////////////////////////////////////////////////////////////////////////////
//                                                                         //
// REST API Config                                                        //
//                                                                         //
// These endpoints handle requests from the browser to get connection      //
// info and requests from the Voice API to handle incoming phone calls     //
//                                                                         //
/////////////////////////////////////////////////////////////////////////////

/**
 * The browser will hit this endpoint to get a conference and participant ID
 */
app.get("/connectionInfo", async (req, res) => {
  const conferenceId = await getConferenceId();
  const participantId = await createParticipant();
  res.send({
    conferenceId: conferenceId,
    participantId: participantId,
    phoneNumber: phoneNumber
  });
  console.log(
    `created new participant ${participantId} in conference ${conferenceId}`
  );
});

/**
 * Bandwidth's Voice API will hit this endpoint when we receive and incoming call
 */
app.post("/incomingCall", async (req, res) => {
  const callId = req.body.callId;
  const from = req.body.from;
  console.log(`received incoming call ${callId} from ${from}`);
  const conferenceId = await getConferenceId();
  const participantId = await createParticipant();

  // This is the response payload that we will send back to the Voice API to transfer the call into the WebRTC conference
  const bxml = `<?xml version="1.0" encoding="UTF-8" ?>
  <Response>
      ${bandwidthRtc.generateTransferBxml(conferenceId, participantId)}
  </Response>`;

  // Send the payload back to the Voice API
  res.contentType("application/xml").send(bxml);
  console.log(
    `transferring ${callId} to conference ${conferenceId} as participant ${participantId}`
  );
});

// These two lines set up static file serving for the React frontend
app.use(express.static(path.join(__dirname, "..", "frontend", "build")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "build", "index.html"));
});

/////////////////////////////////////////////////////////////////////////////
//                                                                         //
// Bandwidth WebRTC Functions                                              //
//                                                                         //
// The following few functions make requests to the WebRTC Service to      //
// create conferences and participants. They also help manage the app's    //
// local state map of who all is in the conference                         //
//                                                                         //
/////////////////////////////////////////////////////////////////////////////

/**
 * Get a new or existing WebRTC conference ID
 */
const getConferenceId = async (): Promise<string> => {
  // If we already have a conference going, just re-use that one
  if (conferenceId) {
    return conferenceId;
  } else {
    // Otherwise start a new one and return the ID
    conferenceId = await bandwidthRtc.startConference();
    console.log(`created new conference ${conferenceId}`);
    return conferenceId;
  }
};

/**
 * Create a new participant and save their ID to our app's state map
 */
const createParticipant = async (): Promise<string> => {
  const conferenceId = await getConferenceId();
  const participantId = await bandwidthRtc.createParticipant(conferenceId);
  participantStreams.set(participantId, []);
  return participantId;
};

/**
 * Remove a participant from the conference and our app's state map
 * @param participantId The ID of the participant to remove
 */
const removeParticipant = async (participantId: string) => {
  participantStreams.delete(participantId);
  bandwidthRtc.removeParticipant(conferenceId, participantId);
};

/////////////////////////////////////////////////////////////////////////////
//                                                                         //
// Bandwidth WebRTC Event Handlers                                         //
//                                                                         //
// This section sets up event handlers for important events coming from    //
// the WebRTC service to our app server. This is where we make business    //
// logic decisions of who gets to subscribe to who, and that sort of thing //
//                                                                         //
/////////////////////////////////////////////////////////////////////////////

/**
 * This event will fire any time someone publishes a new stream
 */
bandwidthRtc.onParticipantPublished(event => {
  const eventConferenceId = event.conferenceId;
  const participantId = event.participantId;
  const streamId = event.streamId;
  // Filter events by the conference we created
  if (eventConferenceId === conferenceId) {
    console.log(`participant ${participantId} published stream ${streamId}`);
    participantStreams.get(event.participantId)?.push(event.streamId);
    subscribeEveryoneToStream(participantId, streamId);
    subscribeNewParticipantToExistingStreams(participantId);
  }
});

/**
 * This function iterates over the participants in the conference,
 * subscribing them to the streamId specified.
 * It will avoid subscribing the publisher to themself to prevent echo.
 * @param publisherId The participantId of the publisher
 * @param streamId The streamId of the stream everyone should subscribe to
 */
const subscribeEveryoneToStream = async (
  publisherId: string,
  streamId: string
) => {
  for (const subscriberId of participantStreams.keys()) {
    // We don't want to subscribe the publisher to themself, so skip that one
    if (subscriberId !== publisherId) {
      await bandwidthRtc.subscribe(conferenceId, subscriberId, streamId);
      console.log(`${subscriberId} subscribed to ${streamId}`);
    }
  }
};

/***
 * This function subscribes someone new to all the other existing streams in the conference
 * @param subscriberId The participantId of the subscriber
 */
const subscribeNewParticipantToExistingStreams = async (
  subscriberId: string
) => {
  for (const publisherId of participantStreams.keys()) {
    // We don't want to subscribe the publisher to themself, so skip that one
    if (publisherId !== subscriberId) {
      const streams = participantStreams.get(publisherId);
      if (streams) {
        for (const streamId of streams) {
          await bandwidthRtc.subscribe(conferenceId, subscriberId, streamId);
          console.log(`${subscriberId} subscribed to ${streamId}`);
        }
      }
    }
  }
};

/**
 * This event will fire any time someone leaves the conference.
 * This is where we will do cleanup.
 */
bandwidthRtc.onParticipantLeft(async event => {
  const eventConferenceId = event.conferenceId;
  const participantId = event.participantId;
  // Filter events by the conference we created
  if (eventConferenceId === conferenceId) {
    await removeParticipant(participantId);
    console.log(`participant ${participantId} has left the conference`);
  }
});

// Connect the server to the Bandwidth WebRTC websocket
bandwidthRtc
  .connect({
    accountId: accountId,
    username: username,
    password: password
  })
  .then(() => {
    console.log("webrtc websocket connected!");
    app.listen(port, () =>
      console.log(`WebRTC Hello World listening on port ${port}!`)
    );
  })
  .catch(error => {
    console.error(error);
  });
