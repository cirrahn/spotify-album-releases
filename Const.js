export class Const {
	static ALL_SCOPES = [
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
	static PORT_CALLBACK = 6660;
	static HOST_CALLBACK = "http://localhost";
	static ENDPOINT_CALLBACK = "/api/provide-token";
	static PLAYLIST_ADD_TRACK_LIMIT = 100;
}
