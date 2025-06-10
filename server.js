import http from 'node:http'; // For creating the HTTP server
import fs from 'node:fs';  // For file system operations (creating directories, writing files)
import path from 'node:path';   // For resolving file paths

// Define the port the server will listen on
const PORT = 3000;
// Define the directory where uploaded files will be stored
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Create the uploads directory if it doesn't exist
// This ensures that our server has a place to store the files
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
  console.log(`Created upload directory: ${UPLOAD_DIR}`);
}

/**
 * Sanitizes a filename to prevent path traversal attacks.
 * Removes directory separators and other potentially harmful characters.
 * @param {string} filename - The original filename.
 * @returns {string} The sanitized filename.
 */
function sanitizeFilename(filename) {
  // Remove any path separators like / or \
  // Replace characters that are invalid in filenames across different OS
  // Keep only alphanumeric characters, dots, and hyphens.
  return filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

// Create the HTTP server
const server = http.createServer((req, res) => {
  // Log the incoming request method and URL for debugging
  console.log(`Request received: ${req.method} ${req.url}`);

  // Handle GET requests: serve the upload form
  if (req.method === 'GET' && req.url === '/') {
    // Set the response header to indicate HTML content
    res.writeHead(200, { 'Content-Type': 'text/html' });
    // Send back a simple HTML form for file uploads
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>File Upload</title>
          <style>
              body { font-family: 'Inter', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background-color: #f0f2f5; margin: 0; }
              .container { background-color: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1); text-align: center; max-width: 500px; width: 90%; }
              h1 { color: #333; margin-bottom: 30px; }
              form { display: flex; flex-direction: column; gap: 20px; }
              input[type="file"], input[type="submit"] { padding: 12px 20px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; width: 100%; box-sizing: border-box; }
              input[type="file"] { background-color: #f9f9f9; cursor: pointer; }
              input[type="submit"] { background-color: #4CAF50; color: white; border: none; cursor: pointer; transition: background-color 0.3s ease; }
              input[type="submit"]:hover { background-color: #45a049; }
              .message { margin-top: 20px; padding: 15px; border-radius: 8px; }
              .success { background-color: #d4edda; color: #155724; border-color: #c3e6cb; }
              .error { background-color: #f8d7da; color: #721c24; border-color: #f5c6cb; }
          </style>
      </head>
      <body>
          <div class="container">
              <h1>Upload Your File</h1>
              <form action="/upload" method="post" enctype="multipart/form-data" id="uploadForm">
                  <label for="myFile" class="sr-only">Choose File</label>
                  <input type="file" name="myFile" id="myFile" required>
                  <input type="submit" value="Upload File">
              </form>
              <div id="message" class="message" style="display: none;"></div>

              <script>
                  document.getElementById('uploadForm').addEventListener('submit', async function(event) {
                      event.preventDefault(); // Prevent default form submission

                      const form = event.target;
                      const formData = new FormData(form);
                      const messageDiv = document.getElementById('message');

                      try {
                          const response = await fetch(form.action, {
                              method: form.method,
                              body: formData,
                          });

                          const result = await response.text(); // Or .json() if server sends JSON

                          messageDiv.style.display = 'block';
                          if (response.ok) {
                              messageDiv.className = 'message success';
                              messageDiv.textContent = result;
                              form.reset(); // Clear the form after successful upload
                          } else {
                              messageDiv.className = 'message error';
                              messageDiv.textContent = result || 'An unknown error occurred.';
                          }
                      } catch (error) {
                          messageDiv.style.display = 'block';
                          messageDiv.className = 'message error';
                          messageDiv.textContent = 'Error uploading file: ' + error.message;
                          console.error('Fetch error:', error);
                      }
                  });
              </script>
          </div>
      </body>
      </html>
    `);
  }
  // Handle POST requests to the /upload endpoint
  else if (req.method === 'POST' && req.url === '/upload') {
    let body = [];
    const contentType = req.headers['content-type'];
    // Ensure it's a multipart form data request
    if (!contentType || !contentType.startsWith('multipart/form-data')) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request: Expected multipart/form-data');
      return;
    }

    // Extract the boundary string from the Content-Type header
    const boundaryMatch = /boundary=(.+)/.exec(contentType);
    if (!boundaryMatch) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request: Missing boundary in Content-Type');
      return;
    }
    const boundary = `--${boundaryMatch[1]}`;
    const boundaryBuffer = Buffer.from(boundary);

    // Accumulate all data chunks into a single buffer
    req.on('data', (chunk) => {
      body.push(chunk);
    });

    req.on('end', () => {
      const fullBuffer = Buffer.concat(body);

      // Find the start and end of the file part
      // We are looking for the structure:
      // --boundary
      // Content-Disposition: form-data; name="myFile"; filename="example.txt"
      // Content-Type: text/plain
      //
      // file content
      // --boundary--

      // Find the first boundary
      const firstBoundaryIndex = fullBuffer.indexOf(boundaryBuffer);
      if (firstBoundaryIndex === -1) {
        console.error('No first boundary found.');
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Error: Could not find multipart boundary.');
        return;
      }

      // Find the end boundary (the one with -- at the end)
      const lastBoundaryIndex = fullBuffer.indexOf(Buffer.from(boundary + '--'));
      if (lastBoundaryIndex === -1) {
        console.error('No last boundary found.');
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Error: Could not find end multipart boundary.');
        return;
      }

      // Extract the content between the first boundary and the last boundary
      // This part includes headers and file data
      const content = fullBuffer.slice(firstBoundaryIndex + boundaryBuffer.length + 2, lastBoundaryIndex); // +2 for CRLF

      // Split content by CRLF to find headers and body
      const CRLF = Buffer.from('\r\n');
      const doubleCRLF = Buffer.from('\r\n\r\n');

      const headersEndIndex = content.indexOf(doubleCRLF);
      if (headersEndIndex === -1) {
        console.error('No headers end found.');
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Error: Malformed multipart part (no double CRLF).');
        return;
      }

      const rawHeaders = content.slice(0, headersEndIndex).toString('utf8');
      const fileData = content.slice(headersEndIndex + doubleCRLF.length);

      // Parse headers to get filename
      let filename = 'untitled';
      const dispositionMatch = /Content-Disposition: form-data; name="myFile"; filename="([^"]+)"/i.exec(rawHeaders);
      if (dispositionMatch && dispositionMatch[1]) {
        filename = sanitizeFilename(decodeURIComponent(dispositionMatch[1]));
      } else {
        console.warn('Could not extract filename from Content-Disposition. Using default filename.');
      }

      const filePath = path.join(UPLOAD_DIR, filename);

      // Write the file data to the specified path
      fs.writeFile(filePath, fileData, (err) => {
        if (err) {
          console.error('Error writing file:', err);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error saving file.');
          return;
        }

        console.log(`File uploaded successfully: ${filename}`);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`File "${filename}" uploaded successfully!`);
      });
    });

    req.on('error', (err) => {
      console.error('Request error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error during request.');
    });

  }
  // Handle other requests (e.g., unknown paths)
  else {
    // Send a 404 Not Found response for unhandled routes
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// Start the server and listen for incoming requests
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Uploads will be saved to: ${UPLOAD_DIR}`);
});
