<details><summary>Setting up Docker</summary>

<details><summary>Linux (Ubuntu)</summary>

1. Install Docker. You will probably want to [install rootless Docker](https://docs.docker.com/engine/security/rootless/) to make development easier in the future, though it is a bit more complicated. Talk to Mikey if you're having issues.
1. [Install docker-compose](https://docs.docker.com/compose/install/) separately (the docker daemon and docker-compose are only bundled on Mac/Windows).
1. Run `git clone https://github.com/ProjectSidewalk/SidewalkWebpage.git` in the directory where you want to put the code.
</details>

<details><summary>Mac</summary>

1. [Install  Docker Desktop](https://www.docker.com/get-started).
1. Run `git clone https://github.com/ProjectSidewalk/SidewalkWebpage.git` in the directory where you want to put the code.
</details>

<details><summary>Windows (WSL2)</summary>

There are two methods to setup your Docker dev environment with Windows: with WSL2 and without. We recommend and only support the *WSL2* installation process.

WSL2 provides an actual Linux kernel running within a lightweight VM, unlike the older WSL which tried to emulate a linux kernel within the Windows kernel—see [Docker's official WSL2 overview](https://docs.docker.com/desktop/windows/wsl/). WSL2 offers faster compile times and is better supported by Docker.

1. [Install  Docker Desktop](https://www.docker.com/get-started). Follow the official [Docker Windows Install Guide](https://docs.docker.com/desktop/windows/install/).
1. [Install WSL2](https://docs.microsoft.com/en-us/windows/wsl/install-win10).
1. Enter the Docker Dashboard and click the settings gear icon in the top right. From there, click the "General" tab and select the "Use the WSL 2 based engine" check box (this will be grayed out and pre-checked if you're running Windows Home).
1. Proceed by clicking **Resources &rarr; WSL Integration** and select your Linux VM of choice under "Enable integration with additional distros:". Here is some extra [documentation](https://docs.docker.com/docker-for-windows/wsl/) from Docker that may help out with this process.
1. Open your Linux VM shell and navigate to where you would like to set up your Project Sidewalk repository.
1. Run `git clone https://github.com/ProjectSidewalk/SidewalkWebpage.git`.

##### Transferring files from Windows to Linux VM
One issue you may encounter when setting up your dev environment within the Linux VM is transferring files (like the database dump) into the VM itself.

1. A simple solution is to open **File Explorer** and, inside the search box at the top, type in `\\wsl$` (this will connect you through network to the Linux VM).
1. Locate the Linux VM within your Project Sidewalk directory (you can right click on it to pin it in your File Explorer) and find the `/mnt` folder.
1. This folder is where your Windows drives are mounted. For example, `/mnt/c` will let you access the files in your C: drive; from here you can use commands like ```cp <source> <destination>``` to move files from your C: drive to your Linux VM's file system.
1. You could also find the `/home/<username>` folder in the Linux VM and locate your SidewalkWebpage directory where you can drag and drop files.

</details>
</details>

<details><summary>Running the code for the first time</summary>
</details>

<details><summary>Running the code again later</summary>
</details>

<details><summary>Dev environment (IDE)</summary>
</details>

<details><summary>Setting up a database in an additional city</summary>
</details>


