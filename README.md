# Pulse Hackathon

What is our Goal?
To avoid overusing data center computing power, we created a network that can send LLM queries to higher performing devices on a centralized server.  This also has positive environmental effects, since less resources at data centers will be used(ie water). 
Another resource being saved is querying time, as queries would be answered faster 

Who loses this resource? 
People who use LLM’s with low performing devices. Companies owning data centers also lose money because of efficient computing power. 

How is this minimal effort if you have to install LM studio to get each model? 
	Because of the time constraints, we were not able to find an easier substitute. With more time, we would host the model on the interface to avoid extra installations. 

How to start up the server?

To start the server the desired device must be set to a static IP 
For local installations set this IP to 192.186.1.2
On the Server side download docker and run the following commands
docker build --no-cache -t pulse-router:offline.
docker save -o pulse-router_offline.tar pulse-router:offline
docker load -i pulse-router_offline.tar
docker run -d --name pulse-router -p 8080:8080 pulse-router:offline
NOTE: Make sure you’re not on a corperate managed network, since firewalls can get in the way of testing and Static IPs cant be set on these networks


## LLM Chat Frontend (Demo)

This folder contains a minimal frontend demo implementing a simple chat UI with:

- model selection dropdown
- chat history
- sidebar with multiple chats
- a textbox/composer for prompts

Files added:

- index.html — main UI
- styles.css — styling
- app.js — chat state, mock LLM replies, and localStorage persistence

Run locally: run "npm run dev"

Notes: The demo uses a mock reply generator in `app.js`. Replace the mock call with an API request to your LLM backend when ready.

<img width="1139" height="715" alt="image" src="https://github.com/user-attachments/assets/9231eccc-c913-4311-874b-7548333afd68" />
