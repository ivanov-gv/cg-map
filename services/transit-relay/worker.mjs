import {createRelay} from './relay.mjs';
const handle = createRelay();
export default {
  fetch(request) {
    if (new URL(request.url).pathname !== '/api/vehicles') return new Response('Not found', {status: 404});
    return handle(request);
  }
};
