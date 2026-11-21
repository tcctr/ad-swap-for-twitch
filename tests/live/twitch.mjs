// Helpers for checks against the real twitch.tv (network needed; results depend on Twitch).
export const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // Twitch's public web client ID

async function gql(body) {
  const r = await fetch("https://gql.twitch.tv/gql", {
    method: "POST", headers: { "Client-ID": CLIENT_ID }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`gql ${r.status}`);
  return r.json();
}

// The most-watched live channels right now (logins), anonymous.
export async function topChannels(n = 5) {
  const j = await gql({ query: `{ streams(first: ${n}) { edges { node { broadcaster { login } } } } }` });
  return j.data.streams.edges.map((e) => e.node.broadcaster.login);
}

export async function playbackToken(channel, playerType, platform = "web") {
  const j = await gql({
    operationName: "PlaybackAccessToken_Template",
    query: "query PlaybackAccessToken_Template($login: String!, $playerType: String!, $platform: String!) {" +
           " streamPlaybackAccessToken(channelName: $login, params: {platform: $platform," +
           " playerBackend: \"mediaplayer\", playerType: $playerType}) { value signature } }",
    variables: { login: channel, playerType, platform },
  });
  return j.data && j.data.streamPlaybackAccessToken;
}

export async function masterPlaylist(channel, token) {
  const q = new URLSearchParams({
    sig: token.signature, token: token.value, allow_source: "true", fast_bread: "true",
    p: String(Math.floor(Math.random() * 1e7)), platform: "web", player_backend: "mediaplayer",
    playlist_include_framerate: "true", supported_codecs: "avc1",
  });
  const r = await fetch(`https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?${q}`);
  if (!r.ok) throw new Error(`usher ${r.status}`);
  return r.text();
}
