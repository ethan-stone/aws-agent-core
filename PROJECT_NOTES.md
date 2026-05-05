# Project Notes

## Deferred Design Sessions

- AgentCore Identity OAuth completion flow: the first tool-auth implementation should return an `auth_required` event/status and let the user retry after authorization. In a later session, design and implement the richer stream/poll flow where the runtime keeps the invocation open while AgentCore Identity waits for OAuth completion.
