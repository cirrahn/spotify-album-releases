import express from "express";
import {Util} from "./Util.js";
import SpotifyWebApi from "spotify-web-api-node";
import {Const} from "./Const.js";
import {SpotifyInterface} from "./SpotifyInterface.js";

const ENDPOINT = "/redirect";

const CSS_FONT_COLOR = `color: #20c20e;`
const CSS_GENERIC = `width: 100vw; height: 100vh; padding: 0; margin: 0; background: black; font-family: monospace; display: flex; align-items: center; justify-content: center; ${CSS_FONT_COLOR}`

const creds = Util.getJson("./credentials.json");
if (!creds.client_id || !creds.client_secret) throw new Error(`Credentials missing!`);

const config = Util.getJson("./config.json");
if (!config.host) throw new Error(`"host" missing from config.json!`);

const getSpotifyApi = () => new SpotifyWebApi({
	clientId: creds.client_id,
	clientSecret: creds.client_secret,
	redirectUri: `${config.host}:${Const.PORT_CALLBACK}${ENDPOINT}`,
});

const app = express();

app.get('/', async (req, res) => {
	const spotifyApi = getSpotifyApi();

	const authorizeURL = await spotifyApi.createAuthorizeURL(Const.ALL_SCOPES);

	res.send(`<body style="${CSS_GENERIC}"><a href="${authorizeURL}" style="${CSS_FONT_COLOR}">click me</a></body>`);
})

app.get('/redirect', async (req, res) => {
	const spotifyApi = getSpotifyApi();

	const authData = await spotifyApi.authorizationCodeGrant(req.query.code);
	spotifyApi.setAccessToken(authData.body['access_token']);
	spotifyApi.setRefreshToken(authData.body['refresh_token']);

	const user = await spotifyApi.getMe();
	const playlistId = await SpotifyInterface.pGetReleaseRadarPlaylistId({spotifyApi, userId: user.body.id});

	await SpotifyInterface.pCreateReleaseRadarPlaylist({spotifyApi, userId: user.body.id, releaseRadarPlaylistId: playlistId});

	res.send(`<body style="${CSS_GENERIC}"><div>enjoy, ${(user.body?.display_name || "").split(" ")[0] || "Mysterious Person"} :)</div></body>`);
});

app.listen(Const.PORT_CALLBACK, () => {
	console.log(`Listening at ${HOST}:${Const.PORT_CALLBACK}`);
});
