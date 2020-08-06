# **Basic Client Examples to demonstrate Broadcast Calls using Enablex Voice APIs. **
This example contains instructions how users can initiate Broadcast Calls.

## Prerequisite
- You will need Enablex Application credentials, app_id and app_key.
- You will need to configure the phone number you purchased from Enablex.
- You will need a place for hosting this application either cloud or local machine.


## Installation
git clone repo url
cd git directory
cd client_examples
npm install

## Setting up configurations.
- Add app_id and app_key & other parameters in config file.
- For Broadcast call client, change configs in config-broadcast.js

## Webhook security
- Webhook security is also implemented as part of the voice service APIs.
- Enablex Voice Server does encryption of Webhook payload using 'md5' encryption and app_id as key.
- Client needs to do decryption of payload using app_id provided by Enablex and algorithm, format, encoding parameters present in x-algoritm, x-format and x-encoding header.
- Please refer to the documentation and examples for proper way of handling Webhook payloads.

## Starting the client application script
- For Broadcast Calls, cd broadcast
  node client-broadcast.js
