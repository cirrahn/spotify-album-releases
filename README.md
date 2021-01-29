1) `npm i`
2) Go to [Spotify's developer dashboard](https://developer.spotify.com/dashboard/applications) and register an application. Set the callback URL as `http://localhost:6660/api/provide-token`
3) `cp credentials.sample.json credentials.json` and edit to include your client ID/secret generated in (2)
4) `cp config.sample.json config.json` and edit to include your user ID and release radar playlist ID (to get the IDs, click e.g. "share" in spotify, then copy the ID from the end of the link)
5) `node Main.js`
