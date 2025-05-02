import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { Client } from '../client/index.js'; // Adjust path as needed
import { McpServer } from '../server/mcp.js'; // Adjust path as needed
import { Transport, TransportSendOptions } from '../shared/transport.js'; // Adjust path as needed
import { CallToolResult, JSONRPCMessage, RequestId } from '../types.js'; // Adjust path as needed
// Assuming AuthInfo might be in a different location or not needed for this basic example
// If needed, find the correct import path for AuthInfo, e.g.:
// import { AuthInfo } from '../server/auth/types.js';

// Define AuthInfo locally if it's simple and the import isn't working
// type AuthInfo = unknown; // Removed AuthInfo

// Shared event emitter for local communication
const localBus = new EventEmitter();
const CLIENT_MSG_EVENT = 'client-message';
const SERVER_MSG_EVENT = 'server-message';

// --- LocalClientTransport Implementation ---
class LocalClientTransport implements Transport {
    private connected = false;
    public sessionId?: string;
    private listener = (message: JSONRPCMessage) => {
        // Received a message from the server side
        // console.log(`ClientTransport [${this.sessionId}] received:`, message);
        if (this.onmessage) {
            // Use setTimeout to avoid direct call stack issues
            setTimeout(() => this.onmessage!(message), 0);
        }
    };

    // Callbacks set by Client/Server
    public onclose?: () => void;
    public onerror?: (error: Error) => void;
    public onmessage?: (message: JSONRPCMessage) => void;

    constructor(private bus: EventEmitter) {
        this.sessionId = `local-client-${randomUUID()}`;
    }

    async start(): Promise<void> {
        if (this.connected) return;
        this.connected = true;
        this.bus.on(SERVER_MSG_EVENT, this.listener);
        // console.log(`ClientTransport [${this.sessionId}] started & listening for server messages.`);
    }

    async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
        if (!this.connected) throw new Error("Transport not connected");
        // console.log(`ClientTransport [${this.sessionId}] sending:`, message);
        // Send message to the server side via the bus
        this.bus.emit(CLIENT_MSG_EVENT, message);
    }

    async close(): Promise<void> {
        if (!this.connected) return;
        this.connected = false;
        this.bus.off(SERVER_MSG_EVENT, this.listener);
        // console.log(`ClientTransport [${this.sessionId}] closed.`);
        if (this.onclose) {
            setTimeout(() => this.onclose!(), 0);
        }
    }
}

// --- LocalServerTransport Implementation ---
class LocalServerTransport implements Transport {
    private connected = false;
    public sessionId?: string;
    private listener = (message: JSONRPCMessage) => {
        // Received a message from the client side
        // console.log(`ServerTransport [${this.sessionId}] received:`, message);
        if (this.onmessage) {
             // Use setTimeout to avoid direct call stack issues
            setTimeout(() => this.onmessage!(message), 0);
        }
    };

    // Callbacks set by Client/Server
    public onclose?: () => void;
    public onerror?: (error: Error) => void;
    public onmessage?: (message: JSONRPCMessage) => void;

    constructor(private bus: EventEmitter) {
        // Server transport often inherits client session ID or generates its own
        // For simplicity, generate a distinct one here
        this.sessionId = `local-server-${randomUUID()}`;
    }

    async start(): Promise<void> {
        if (this.connected) return;
        this.connected = true;
        this.bus.on(CLIENT_MSG_EVENT, this.listener);
         // console.log(`ServerTransport [${this.sessionId}] started & listening for client messages.`);
    }

    async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
        if (!this.connected) throw new Error("Transport not connected");
        // console.log(`ServerTransport [${this.sessionId}] sending:`, message);
        // Send message to the client side via the bus
        this.bus.emit(SERVER_MSG_EVENT, message);
    }

    async close(): Promise<void> {
        if (!this.connected) return;
        this.connected = false;
        this.bus.off(CLIENT_MSG_EVENT, this.listener);
        // console.log(`ServerTransport [${this.sessionId}] closed.`);
        if (this.onclose) {
            setTimeout(() => this.onclose!(), 0);
        }
    }
}

// --- Example Usage ---

async function runLocalExample() {
    console.log("Setting up local MCP client-server example with separate transports...");

    // 1. Create the Server
    const server = new McpServer({ name: 'local-server', version: '1.0.0' });
    server.tool(
        'local-echo',
        'Echoes back the input',
        { text: z.string() },
        async ({ text }): Promise<CallToolResult> => ({ content: [{ type: 'text', text: `Server received: ${text}` }] })
    );

    // 2. Create the Client
    const client = new Client({ name: 'local-client', version: '1.0.0' });

    // 3. Create the Transports (sharing the same event bus)
    const sharedBus = new EventEmitter();
    const clientTransport = new LocalClientTransport(sharedBus);
    const serverTransport = new LocalServerTransport(sharedBus);

    // 4. Wire up Server Message Handling
    // McpServer doesn't have a .connect() like Client.
    // We manually set the onmessage handler for the server's transport
    // and make it call the server's internal protocol handler.
    serverTransport.onmessage = (msg: JSONRPCMessage) => {
        console.log("Server processing message:", msg);
        try {
            // Accessing protected protocol instance - necessary hack for local transport
            (server as any).protocol.handleIncomingMessage(msg);
        } catch (e) {
            console.error("Server error handling message", e);
            // Optionally send an error response back via serverTransport.send if possible
        }
    };
    // Start the server transport so it begins listening on the bus
    await serverTransport.start();

    // 5. Connect Client
    console.log("Connecting client...");
    // client.connect will call clientTransport.start() internally
    // and handle setting clientTransport.onmessage
    client.connect(clientTransport)
        .then(() => {
            console.log("Client connected successfully!");
            // 6. Perform an action
            console.log("Calling local-echo tool...");
            return client.callTool({ tool: 'local-echo', parameters: { text: 'hello local world' } });
        })
        .then(result => {
            console.log("Client received result:", result);
        })
        .catch(error => {
            console.error("Error during local MCP communication:", error);
        })
        .finally(async () => {
            console.log("Closing transports...");
            // Close both transports
            await client.close(); // This should close the client transport
            await serverTransport.close();
            // Clean up the bus listeners
            sharedBus.removeAllListeners();
            console.log("Finished.");
        });
}

runLocalExample().catch(err => console.error("Example failed:", err)); 
