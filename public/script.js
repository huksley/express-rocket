/* eslint-disable no-console */

if (API_TOKEN) {
  fetch('api/ping', {
    method: 'GET',
    mode: 'cors',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + API_TOKEN
    }
  })
    .then(response => response.json())
    .then(json => {
      console.info(json.pong)
    })
    .catch(error => console.warn(error))
}
