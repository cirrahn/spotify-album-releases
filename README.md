1) `npm i`
2) Go to [https://developer.spotify.com/dashboard/applications] and register and application. Set the callback URL as `http://localhost:6660/api/provide-token`
3) `cp credentials.sample.json credentials.json` and enter your client ID/secret
4) `cp config.sample.json config.json` and enter your user ID and release radar playlist ID (share the link in spotify, then copy the ID from the end of the link)
5) `node Main.js`
