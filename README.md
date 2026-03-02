# Pulse Hackathon

## What is our goal?

To avoid reliance on data centers, we created a system that allows capable devices on a network to register themselves as LLM servers. Lower-powered devices, such as smartphones, can send a request to the central server to learn about LLM servers on the network and their status.

## How to start up the routing server

To start the server, the desired device must be set to a static IP 

For local installations set this IP to 192.186.1.2

On the Server side download docker and run the following commands

docker build --no-cache -t pulse-router:offline.

docker save -o pulse-router_offline.tar pulse-router:offline

docker load -i pulse-router_offline.tar

docker run -d --name pulse-router -p 8080:8080 pulse-router:offline

NOTE: Make sure you’re not on a corporate managed network, since firewalls can get in the way of testing and static IPs cannot be set on these networks.

## How to start up the client frontend

Run locally: run "npm run dev"

## Implementation details

### Compute server - routing server interactions
* The core of this system is the routing server, whose IP address is known to all devices on the network. Currently, this constraint is satisfied by assigning it a static IP.
* If a machine wants to act as an LLM server on a network, it sends a registration request to the routing server.
* Every 2 seconds, LLM servers send a heartbeat to the routing server to signal liveness, as well as send performance statistics (current in-flight requests, estimated tokens-per-second output).
* If three heartbeats are missed, then the routing server will no longer consider the LLM server to be live and will stop redirecting requests.

### User - routing server interactions
* When a user sends a message, the client will first send a request to the routing server containing metadata (query length, requested model).
* The routing server selects the optimal compute server based on the performance statistics it receives from heartbeats, and sends its info back to the user.

### User - compute server interactions
* Upon receiving a response from the routing server, the client will send the full LLM query to a FastAPI endpoint on the specified compute server.
* The compute server will forward the request to a locally running instance of LMStudio. After LMStudio responds with the LLM output, the FastAPI layer will compute + store some performance statistics, and send the output back to the user.


### System design diagram
<img width="1134" height="717" alt="image" src="https://github.com/user-attachments/assets/e46ea095-e96c-47f4-b034-cacd513288be" />

