export class Const {
	static ALL_SCOPES = [
		"user-top-read",
		"playlist-modify-public",
		"playlist-modify-private",
		"playlist-read-private",
		"playlist-read-collaborative",
		"user-follow-read",
		"user-library-read",
	];
	static PORT_CALLBACK = 6660;
	static HOST_CALLBACK = "http://localhost";
	static ENDPOINT_CALLBACK = "/api/provide-token";
	static PLAYLIST_ADD_TRACK_LIMIT = 100;
}
