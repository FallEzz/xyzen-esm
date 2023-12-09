import { spawn } from "child_process";
import path from "path";

const starting = () => {
    let args = [path.join('main.js'), ...process.argv.slice(2)]
    console.log([process.argv[0], ...args].join('\n'))
    let p = spawn(process.argv[0], args, {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    }).on('message', data => {
        if (data == 'reset') {
            console.log('reset');
            p.kill();
            starting();
        }
    })
}

starting();