import React, { useState, useEffect } from "react";
import "./App.css";

import BandwidthRtc, { RtcStream } from "@bandwidth/webrtc-browser-sdk";

const bandwidthRtc = new BandwidthRtc();

const App: React.FC = () => {
  // We will use these state variables to hold our conference ID, participant ID, and phone number
  const [conferenceId, setConferenceId] = useState<string>();
  const [participantId, setParticipantId] = useState<string>();
  const [phoneNumber, setPhoneNumber] = useState<string>();

  // This state variable holds the remote stream object - the audio from the phone
  const [remoteStream, setRemoteStream] = useState<RtcStream>();

  // This effect connects to our server backend to get a conference and participant ID
  // It will only run the first time this component renders
  useEffect(() => {
    fetch("/connectionInfo").then(async response => {
      const responseBody = await response.json();
      setConferenceId(responseBody.conferenceId);
      setParticipantId(responseBody.participantId);
      setPhoneNumber(responseBody.phoneNumber);
    });
  }, []);

  // This effect will fire when the conference or participant IDs change
  // It will connect a websocket to Bandwidth WebRTC, and start streaming the browser's mic
  useEffect(() => {
    if (conferenceId && participantId) {
      // Connect to Bandwidth WebRTC
      bandwidthRtc
        .connect({
          conferenceId: conferenceId,
          participantId: participantId
        })
        .then(async () => {
          console.log("connected to bandwidth webrtc!");
          // Publish the browser's microphone
          await bandwidthRtc.publish({
            audio: true,
            video: false
          });
          console.log("browser mic is streaming");
        });
    }
  }, [conferenceId, participantId]);

  // This effect sets up event SDK event handlers for remote streams
  useEffect(() => {
    // This event will fire any time a new stream is sent to us
    bandwidthRtc.onSubscribe(rtcStream => {
      console.log("receiving audio from phone!");
      setRemoteStream(rtcStream);
    });

    // This event will fire any time a stream is no longer being sent to us
    bandwidthRtc.onUnsubscribe(() => {
      console.log("no longer receiving audio from phone");
      setRemoteStream(undefined);
    });
  });

  return (
    <div className="App">
      <header className="App-header">
        <div>WebRTC Hello World</div>
        {remoteStream ? (
          <div>
            <video
              playsInline
              autoPlay
              style={{ display: "none" }}
              ref={videoElement => {
                if (
                  videoElement &&
                  remoteStream &&
                  videoElement.srcObject !== remoteStream.mediaStream
                ) {
                  // Set the video element's source object to the WebRTC MediaStream
                  videoElement.srcObject = remoteStream.mediaStream;
                }
              }}
            ></video>
            Hooray! You're connected!
          </div>
        ) : (
          <div>
            Dial {phoneNumber || "your Voice API phone number"} to chat with
            this browser
          </div>
        )}
      </header>
    </div>
  );
};

export default App;
