export async function fetchJSONFromAPI(apiUrl, sourceName) {
  let response;
  try {
    response = await fetch(apiUrl);
  } catch {
    throw new Error(`${sourceName}: endpoint ${apiUrl} inaccessible.`);
  }
  if (!response.ok) {
    throw new Error(`${sourceName} indisponible via ${apiUrl} (${response.status}).`);
  }
  return response;
}
