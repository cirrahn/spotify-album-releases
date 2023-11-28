import SpotifyWebApi from 'spotify-web-api-node'
import * as fs from "fs";
import express from "express";
import opn from "opn";
import fetch from "node-fetch";

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
			res.send(`<body style="width: 100vw; height: 100vh; background: black; color: #20c20e; font-family: monospace; display: flex; align-items: center; justify-content: center;">ty for the code</body>`);
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

		const albumMetas = await this._pGetRealAlbums({spotifyApi, albumIds});

		const allTrackUris = [];
		for (const albumMeta of albumMetas) {
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

	/**
	 * Spotify has an annoying habit of putting non-explicit versions of albums in the release radar playlist.
	 * We're all consenting adults here, so go dredge up the original versions. This requires us to use the search API,
	 * as there is no link between album versions.
	 * This *also* requires us to check the entire track listings for each ambiguous album, as the album itself does not
	 * have an "explicit" flag. :(
	 */
	static async _pGetRealAlbums ({spotifyApi, albumIds}) {
		const albumDatas = await this._pGetAlbumDatas({spotifyApi, albumIds});

		const out = [];

		for (const albumMeta of albumDatas) {
			console.log(`Fetching matching albums for "${albumMeta.name}"`);

			const artistName = albumMeta.artists[0]?.name;
			if (!artistName) {
				console.log(`\tNo artist found, using default version`);
				out.push(albumMeta);
				continue;
			}

			const matchingAlbumMetas = await this._pGetMatchingAlbumMetas({spotifyApi, albumName: albumMeta.name, artistName: artistName});
			if (matchingAlbumMetas.length <= 1) {
				console.log(`\tOnly one version found, using default`);
				out.push(albumMeta);
				continue;
			}

			const matchingAlbumMetasExplicit = matchingAlbumMetas.filter(it => it.tracks.items.some(it => it.explicit));
			if (matchingAlbumMetasExplicit.length) {
				console.log(`\tExplicit version found, using explicit version`);
				out.push(matchingAlbumMetasExplicit[0]);
				continue;
			}
			console.log(`\tUsing default version`);
			out.push(matchingAlbumMetas[0]);
		}

		return out;
	}

	static async _pGetAlbumDatas ({spotifyApi, albumIds}) {
		albumIds = [...albumIds];
		const out = [];
		for (let i = 0; i < albumIds.length; i += 20) {
			out.push(...(await spotifyApi.getAlbums(albumIds.slice(i, i + 20))).body.albums)
		}
		return out;
	}

	static async _pGetMatchingAlbumMetas ({spotifyApi, albumName, artistName}) {
		const allFetched = [];
		const outRaw = [];

		const limit = 50;
		let total = limit; // Fabricate a total number of results
		for (let offset = 0; offset < total; offset += 50) {
			// The SDK seems to have difficulty encoding the query correctly, so bodge it ourselves using the SDK's creds
			const resp = await fetch(
				// `tag:new` limits to albums released in the last 2 weeks
				`https://api.spotify.com/v1/search?type=album&limit=${limit}&offset=${offset}&q=name:${encodeURIComponent(albumName)}+artist:${encodeURIComponent(artistName)}+tag:new`,
				{
					headers: {
						"Authorization": `Bearer ${spotifyApi._credentials.accessToken}`,
					}
				}
			);

			// region Handle errors by falling back on our original album
			const body = await resp.text();
			let matchingAlbums;
			try {
				matchingAlbums = JSON.parse(body);
			} catch (e) {
				console.error(`Failed to fetch! API responded with ${resp.status}`)
				return [];
			}
			// endregion

			if (matchingAlbums.error) {
				console.error(`Failed to fetch! API responded with ${matchingAlbums.error.status}`)
				return [];
			}

			allFetched.push(...matchingAlbums.albums.items);
			outRaw.push(...matchingAlbums.albums.items.filter(it => it.name === albumName && it.artists[0]?.name === artistName));
			total = matchingAlbums.albums.total; // Update the total to the real value
		}

		if (outRaw.length === 0) {
			console.warn(`\tFailed to find "${albumName}" by "${artistName}" in search!`);
		}

		// If there is only one match, return it as-is, since we can use our existing version
		if (outRaw.length <= 1) return outRaw;

		// If there are multiple matches, we need to pull each from the albums API, as the search API returns them
		//   without track listings.
		const out = await this._pGetAlbumsByIds({spotifyApi, albumIds: outRaw.map(it => it.id)});

		// Filter to only versions which have the maximal length, as we assume these are preferable (deluxe editions etc.)
		const maxTracks = Math.max(...out.map(it => it.tracks.total));
		return out.filter(it => it.tracks.total === maxTracks);
	}

	/**
	 * Albums can only be fetched 20 at a time.
	 */
	static async _pGetAlbumsByIds ({spotifyApi, albumIds}) {
		const out = [];
		for (let i = 0; i < albumIds.length; i += 20) {
			out.push(...(await spotifyApi.getAlbums(albumIds.slice(i, i + 20))).body.albums);
		}
		return out;
	}

	static async _pUpdatePlaylist (spotifyApi, trackUris) {
		const curPlaylistsData = await spotifyApi.getUserPlaylists(Main._CONFIG.user_id, {limit: 50});
		if (curPlaylistsData.body.total > curPlaylistsData.body.limit) throw new Error(`Need to implement pagination!`);

		const curReleaseRadarAlbumPlaylists = curPlaylistsData.body.items
			.filter(it => it.owner.id === Main._CONFIG.user_id /*|| it.owner.id === "spotify"*/)
			.filter(it => /^Release Radar Albums \(.*?\)$/.exec(it.name));

		// Create a new playlist
		const playlistName = `Release Radar Albums (${Util.getDateString()})`;
		console.log(`Creating playlist "${playlistName}"`)
		const nxtPlaylistData = await spotifyApi.createPlaylist(playlistName, {
			'description': 'Album releases from your Release Radar',
			'public': false
		});

		// Add tracks; tracks have to be added in batches of 100
		console.log("Adding tracks");
		for (let i = 0, len = trackUris.length; i < len; i += Const.PLAYLIST_ADD_TRACK_LIMIT) {
			await spotifyApi.addTracksToPlaylist(nxtPlaylistData.body.id, trackUris.slice(0, Const.PLAYLIST_ADD_TRACK_LIMIT));
			trackUris = trackUris.slice(Const.PLAYLIST_ADD_TRACK_LIMIT);
		}

		// Delete the old playlists, if any exist
		console.log("Removing old playlists")
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

