import { pullRequestClosed, header } from '../../../webhooks/gogs/PullRequestEvents';
import { sendGogsRequest } from '../../../utils/utils';

export default function() {
  return Promise.resolve()
    .then(() => sendGogsRequest(pullRequestClosed, header))
    .then(resp => resp.msg === 'ok' ? Promise.resolve() : Promise.reject(resp))
    .catch(err => Promise.reject(err));
}
