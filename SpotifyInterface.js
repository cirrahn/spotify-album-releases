import {Util} from "./Util.js";
import {Const} from "./Const.js";

export class SpotifyInterface {
	static async pCreateReleaseRadarPlaylist ({spotifyApi, releaseRadarPlaylistId, userId}) {
		const trackUris = await SpotifyInterface._pGetReleaseRadarUris({spotifyApi, releaseRadarPlaylistId});
		await SpotifyInterface._pUpdatePlaylist({spotifyApi, trackUris, userId});
	}

	/* ------------------------------------------------ */

	static async _pGetReleaseRadarUris ({spotifyApi, releaseRadarPlaylistId}) {
		const playlistData = await spotifyApi.getPlaylist(releaseRadarPlaylistId, {limit: 1000});

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
			out.push(...(await spotifyApi.getAlbums(albumIds.slice(i, i + 20))).body.albums);
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
			const url = new URL("https://api.spotify.com/v1/search");

			[
				{key: "type", value: "album"},
				{key: "limit", value: limit},
				{key: "offset", value: offset},
				{key: "locale", value: "GB"},
				// `tag:new` limits to albums released in the last 2 weeks
				{key: "q", value: `album:${this._getCleanQueryName(albumName)} artist:${this._getCleanQueryName(artistName)} tag:new`},
			].forEach(({key, value}) => url.searchParams.append(key, value));

			const resp = await fetch(
				url,
				{
					headers: {
						"Authorization": `Bearer ${spotifyApi._credentials.accessToken}`,
					},
				},
			);

			// region Handle errors by falling back on our original album
			const body = await resp.text();
			let matchingAlbums;
			try {
				matchingAlbums = JSON.parse(body);
			} catch (e) {
				console.error(`Failed to fetch! API responded with ${resp.status}`);
				return [];
			}
			// endregion

			if (matchingAlbums.error) {
				console.error(`Failed to fetch! API responded with ${matchingAlbums.error.status}`);
				return [];
			}

			allFetched.push(...matchingAlbums.albums.items);
			outRaw.push(...matchingAlbums.albums.items.filter(it => it.album_type !== "single" && it.name === albumName && it.artists[0]?.name === artistName));
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

	static _getCleanQueryName (str) {
		return str
			.replace(/:/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			;
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

	static async _pUpdatePlaylist ({spotifyApi, trackUris, userId}) {
		const curPlaylistsData = await spotifyApi.getUserPlaylists(userId, {limit: 50});
		if (curPlaylistsData.body.total > curPlaylistsData.body.limit) throw new Error(`Need to implement pagination!`);

		const curReleaseRadarAlbumPlaylists = curPlaylistsData.body.items
			.filter(it => it.owner.id === userId /*|| it.owner.id === "spotify"*/)
			.filter(it => /^Release Radar Albums \(.*?\)$/.exec(it.name));

		// Create a new playlist
		const playlistName = `Release Radar Albums (${Util.getDateString()})`;
		console.log(`Creating playlist "${playlistName}"`);
		const nxtPlaylistData = await spotifyApi.createPlaylist(playlistName, {
			'description': 'Album releases from your Release Radar',
			'public': false,
		});

		// Add tracks; tracks have to be added in batches of 100
		console.log("Adding tracks");
		for (let i = 0, len = trackUris.length; i < len; i += Const.PLAYLIST_ADD_TRACK_LIMIT) {
			await spotifyApi.addTracksToPlaylist(nxtPlaylistData.body.id, trackUris.slice(0, Const.PLAYLIST_ADD_TRACK_LIMIT));
			trackUris = trackUris.slice(Const.PLAYLIST_ADD_TRACK_LIMIT);
		}

		// Delete the old playlists, if any exist
		console.log(`Removing ${curReleaseRadarAlbumPlaylists.length} old playlist(s)`);
		for (const curReleaseRadarAlbumPlaylist of curReleaseRadarAlbumPlaylists) {
			await spotifyApi.unfollowPlaylist(curReleaseRadarAlbumPlaylist.id);
		}
	}

	/* ------------------------------------------------ */

	static async pGetReleaseRadarPlaylistId ({spotifyApi, userId}) {
		const curPlaylistsData = await spotifyApi.getUserPlaylists(userId, {limit: 50});
		if (curPlaylistsData.body.total > curPlaylistsData.body.limit) throw new Error(`Need to implement pagination!`);

		const curReleaseRadarPlaylists = curPlaylistsData.body.items
			.filter(it => it.owner.id === "spotify")
			.filter(it => it.name === "Release Radar");

		if (!curReleaseRadarPlaylists.length) throw new Error(`Could not find release radar playlist!`);
		if (curReleaseRadarPlaylists.length > 1) throw new Error(`Found multiple release radar playlists!?`);
		return curReleaseRadarPlaylists[0].id;
	}
}
