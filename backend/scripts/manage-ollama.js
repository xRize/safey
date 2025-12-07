import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Kill all Ollama processes
 */
async function killOllama() {
  try {
    console.log('🛑 Stopping existing Ollama processes...');
    
    // Find Ollama processes
    const { stdout } = await execAsync('netstat -aon | findstr 11434');
    const lines = stdout.split('\n').filter(line => line.trim());
    
    const pids = new Set();
    for (const line of lines) {
      const match = line.match(/\s+(\d+)\s*$/);
      if (match) {
        pids.add(match[1]);
      }
    }
    
    // Kill each process
    for (const pid of pids) {
      try {
        await execAsync(`taskkill /F /PID ${pid}`);
        console.log(`   ✅ Killed process ${pid}`);
      } catch (err) {
        // Process might already be dead
        console.log(`   ⚠️  Process ${pid} not found or already stopped`);
      }
    }
    
    if (pids.size === 0) {
      console.log('   ℹ️  No Ollama processes found');
    }
    
    // Wait a bit for ports to be released
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return true;
  } catch (err) {
    // If netstat fails, Ollama might not be running - that's okay
    console.log('   ℹ️  No Ollama processes found (or netstat failed)');
    return true;
  }
}

/**
 * Start Ollama serve
 */
async function startOllama() {
  try {
    console.log('🚀 Starting Ollama server...');
    
    // Start Ollama in the background (detached on Windows)
    const isWindows = process.platform === 'win32';
    
    const ollamaProcess = spawn('ollama', ['serve'], {
      detached: isWindows ? false : true, // On Windows, keep attached so we can monitor
      stdio: 'ignore',
      shell: isWindows
    });
    
    // On Unix, detach the process
    if (!isWindows && ollamaProcess.pid) {
      ollamaProcess.unref();
    }
    
    // Wait a bit for Ollama to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if Ollama is running
    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      try {
        const response = await fetch('http://localhost:11434/api/tags', {
          signal: AbortSignal.timeout(3000)
        });
        if (response.ok) {
          console.log('✅ Ollama server started successfully');
          return ollamaProcess;
        }
      } catch (err) {
        attempts++;
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    console.warn('⚠️  Ollama started but not responding yet (may still be loading)');
    console.warn('   It should be ready in a few seconds');
    return ollamaProcess;
  } catch (err) {
    console.error('❌ Failed to start Ollama:', err);
    return null;
  }
}

/**
 * Main function
 */
export async function manageOllama() {
  await killOllama();
  const process = await startOllama();
  return process;
}

// If run directly (for testing)
if (import.meta.url && (import.meta.url.includes('manage-ollama.js') || process.argv[1]?.endsWith('manage-ollama.js'))) {
  manageOllama().catch(console.error);
}

