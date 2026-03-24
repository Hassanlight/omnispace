const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');
const http = require('http');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: '*',
    methods: ['GET', 'POST']
  } 
});

app.use(cors());
app.use(express.json());

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/omnichannel';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.log('MongoDB error:', err));

// Message Schema
const messageSchema = new mongoose.Schema({
  platform: { type: String, enum: ['whatsapp', 'instagram', 'facebook'] },
  senderId: String,
  senderName: String,
  content: String,
  direction: { type: String, enum: ['incoming', 'outgoing'] },
  timestamp: { type: Date, default: Date.now },
  status: { type: String, default: 'sent' }
});

const Message = mongoose.model('Message', messageSchema);

// Conversation Schema
const conversationSchema = new mongoose.Schema({
  platform: String,
  customerId: String,
  customerName: String,
  lastMessage: String,
  unreadCount: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});

const Conversation = mongoose.model('Conversation', conversationSchema);

// Get all messages
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: -1 }).limit(50);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get messages by conversation
app.get('/api/messages/:conversationId', async (req, res) => {
  try {
    const messages = await Message.find({ 
      senderId: req.params.conversationId 
    }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send message
app.post('/api/messages', async (req, res) => {
  try {
    const msg = await Message.create(req.body);
    
    await Conversation.findOneAndUpdate(
      { customerId: req.body.senderId },
      { 
        lastMessage: req.body.content,
        updatedAt: new Date()
      },
      { upsert: true }
    );
    
    io.emit('new_message', msg);
    res.json(msg);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get conversations
app.get('/api/conversations', async (req, res) => {
  try {
    const conversations = await Conversation.find().sort({ updatedAt: -1 });
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WhatsApp Webhook
app.post('/webhook/whatsapp', async (req, res) => {
  console.log('WhatsApp message received:', req.body);
  
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (messages && messages.length > 0) {
      for (const message of messages) {
        await Message.create({
          platform: 'whatsapp',
          senderId: message.from,
          senderName: value.contacts?.[0]?.profile?.name || 'Unknown',
          content: message.text?.body || '[Media]',
          direction: 'incoming',
          timestamp: new Date()
        });
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(200);
  }
});

// WhatsApp Webhook Verification
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'my-verify-token';
  
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WhatsApp webhook verified');
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Meta Webhook
app.post('/webhook/meta', async (req, res) => {
  console.log('Meta message received:', req.body);
  res.sendStatus(200);
});

// Meta Webhook Verification
app.get('/webhook/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'my-verify-token';
  
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Meta webhook verified');
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// AI Reply
app.post('/api/ai/reply', async (req, res) => {
  try {
    const { conversationId } = req.body;
    const messages = await Message.find({ senderId: conversationId })
      .sort({ timestamp: -1 })
      .limit(5);
    
    const lastMessage = messages[0];
    let reply = "Thank you for your message. How can I help you today?";
    
    if (lastMessage?.content?.toLowerCase().includes('price')) {
      reply = "I'd be happy to discuss pricing. Could you provide more details?";
    } else if (lastMessage?.content?.toLowerCase().includes('help')) {
      reply = "I'm here to help! What assistance do you need?";
    }
    
    res.json({ reply, confidence: 0.85 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('join_conversation', (conversationId) => {
    socket.join(conversationId);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
