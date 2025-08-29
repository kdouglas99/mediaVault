FROM node:18-alpine

WORKDIR /app

# Copy root package files (contains dependencies for backend)
COPY package*.json ./

# Install dependencies (production only is fine here)
RUN npm ci --omit=dev

# Copy only the backend source into the image under /app/server
COPY server ./server

# Ensure uploads directory exists within the server folder
RUN mkdir -p server/uploads

# Expose backend port
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http=require('http');const options={hostname:'localhost',port:3001,path:'/health',timeout:2000};const req=http.request(options,(res)=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.end();"

# Start the backend directly with Node
CMD ["node", "server/server.js"]