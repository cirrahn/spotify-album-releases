const SpotifyWebApi = require('spotify-web-api-node');
const fs = require("fs");
const express = require('express');
const opn = require('opn');

class Const {
}

Const.ALL_SCOPES = [
	"ugc-image-upload",
	"user-read-recently-played",
	"user-top-read",
	"user-read-playback-position",
	"user-read-playback-state",
	"user-modify-playback-state",
	"user-read-currently-playing",
	"app-remote-control",
	"streaming",
	"playlist-modify-public",
	"playlist-modify-private",
	"playlist-read-private",
	"playlist-read-collaborative",
	"user-follow-modify",
	"user-follow-read",
	"user-library-modify",
	"user-library-read",
	"user-read-email",
	"user-read-private",
];
Const.PORT_CALLBACK = 6660;
Const.HOST_CALLBACK = "http://localhost";
Const.ENDPOINT_CALLBACK = "/api/provide-token"
Const.PLAYLIST_ADD_TRACK_LIMIT = 100;

class Util {
	static getJson (path) {
		return JSON.parse(fs.readFileSync(path, "utf-8"));
	}

	static getDateString () {
		const date = new Date();
		return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
	}
}

/** Run a tiny express server to accept callback redirects. */
class ExpressWrapper {
	static pInit () {
		const app = express()

		app.get('/api/provide-token', (req, res) => {
			const code = req.query.code;
			if (!code) throw new Error("No code!");
			ExpressWrapper._RESOLVE_CODE(code);
			res.send("ty for the code");
		})

		return new Promise(resolve => {
			app.listen(Const.PORT_CALLBACK, () => {
				console.log(`Listening at ${Const.HOST_CALLBACK}:${Const.PORT_CALLBACK}`);
				resolve();
			});
		})
	}
}

ExpressWrapper.PROMISE_CODE = new Promise(resolve => {
	ExpressWrapper._RESOLVE_CODE = resolve;
});

class Main {
	static async run () {
		await ExpressWrapper.pInit();

		const spotifyApi = await this._pGetSpotifyApi();
		const uris = await this._pGetReleaseRadarUris(spotifyApi);
		await this._pUpdatePlaylist(spotifyApi, uris);
	}

	static async _pGetSpotifyApi () {
		const creds = Util.getJson("./credentials.json");
		if (!creds.client_id || !creds.client_secret) throw new Error(`Credentials missing!`);

		const config = Util.getJson("./config.json");
		if (!config.user_id || !config.release_radar_playlist_id) throw new Error(`Config missing!`);
		Main._CONFIG = config;

		const spotifyApi = new SpotifyWebApi({
			clientId: creds.client_id,
			clientSecret: creds.client_secret,
			redirectUri: `${Const.HOST_CALLBACK}:${Const.PORT_CALLBACK}${Const.ENDPOINT_CALLBACK}`,
		});

		const authorizeURL = await spotifyApi.createAuthorizeURL(Const.ALL_SCOPES);
		opn(authorizeURL, {app: 'chrome'});
		console.log(authorizeURL);

		const code = await ExpressWrapper.PROMISE_CODE;
		const authData = await spotifyApi.authorizationCodeGrant(code);
		spotifyApi.setAccessToken(authData.body['access_token']);
		spotifyApi.setRefreshToken(authData.body['refresh_token']);

		// region Client credentials version--does not allow user stuff
		// const data = await spotifyApi.clientCredentialsGrant();
		// spotifyApi.setAccessToken(data.body['access_token']);
		// endregion

		return spotifyApi;
	}

	static async _pGetReleaseRadarUris (spotifyApi) {
		const playlistData = await spotifyApi.getPlaylist(Main._CONFIG.release_radar_playlist_id, {limit: 1000});

		if (playlistData.body.tracks.total > playlistData.body.tracks.limit) throw new Error(`Need to implement pagination!`);

		const albumTracks = playlistData.body.tracks.items.filter(trackMeta => trackMeta.track && trackMeta.track.album.album_type === "album");
		// Deduplicate album IDs
		const albumIds = new Set(albumTracks.map(trackMeta => trackMeta.track.album.id));

		const albumDatas = await spotifyApi.getAlbums([...albumIds]);

		const allTrackUris = [];
		for (const albumMeta of albumDatas.body.albums) {
			const albumTracks = [...albumMeta.tracks.items];

			// Tracks get pulled in bundles of 50
			for (let i = 50; i < albumMeta.tracks.total; i += 50) {
				const nxtTracksData = await spotifyApi.getAlbumTracks(albumMeta.id, {limit: 50, offset: i});
				albumTracks.push(...nxtTracksData.body.items);
			}

			allTrackUris.push(...albumTracks.map(it => it.uri));
		}

		return allTrackUris;
	}

	static async _pUpdatePlaylist (spotifyApi, trackUris) {
		const curPlaylistsData = await spotifyApi.getUserPlaylists(Main._CONFIG.user_id, {limit: 50});
		if (curPlaylistsData.body.total > curPlaylistsData.body.limit) throw new Error(`Need to implement pagination!`);

		const curReleaseRadarAlbumPlaylists = curPlaylistsData.body.items
			.filter(it => it.owner.id === Main._CONFIG.user_id /*|| it.owner.id === "spotify"*/)
			.filter(it => /^Release Radar Albums \(.*?\)$/.exec(it.name));

		// Create a new playlist
		const nxtPlaylistData = await spotifyApi.createPlaylist(`Release Radar Albums (${Util.getDateString()})`, {
			'description': 'Album releases from your Release Radar',
			'public': false
		});

		// Add tracks; tracks have to be added in batches of 100
		for (let i = 0, len = trackUris.length; i < len; i += Const.PLAYLIST_ADD_TRACK_LIMIT) {
			await spotifyApi.addTracksToPlaylist(nxtPlaylistData.body.id, trackUris.slice(0, Const.PLAYLIST_ADD_TRACK_LIMIT));
			trackUris = trackUris.slice(Const.PLAYLIST_ADD_TRACK_LIMIT);
		}

		// Delete the old playlists, if any exist
		for (const curReleaseRadarAlbumPlaylist of curReleaseRadarAlbumPlaylists) {
			await spotifyApi.unfollowPlaylist(curReleaseRadarAlbumPlaylist.id);
		}
	}
}
Main._CONFIG = null;

Main.run()
	.catch(e => {
		throw e;
	})
	.then(() => {
		console.log("Done!");
		process.exit(0); // Force exit to kill the Express server
	});

