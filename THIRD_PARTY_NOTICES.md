# THIRD PARTY NOTICES

PiX 工具包（pix-tools-windows-amd64）再分发的第三方工具及其许可证汇总。
各工具版权归原作者所有；随包分发遵循下列许可条款。完整许可原文见各工具目录内 LICENSE 文件或上游仓库。

| 工具 | 上游 | 许可证 |
|---|---|---|
| subfinder / httpx / naabu / nuclei / nuclei-templates / katana | projectdiscovery.io（github.com/projectdiscovery/*） | MIT |
| crt.sh CLI | github.com/az7rb/crt.sh | MIT |
| ffuf | github.com/ffuf/ffuf | MIT |
| dirsearch | github.com/maurosoria/dirsearch | MIT |
| URLFinder | github.com/pingc0y/URLFinder | MIT |
| waybackurls | github.com/tomnomnom/waybackurls | MIT |
| OneForAll | github.com/shmilylty/OneForAll | MIT |
| LinkFinder | github.com/GerbenJavado/LinkFinder | MIT |
| fscan | github.com/shadow1ng/fscan | MIT |
| EHole | github.com/EdgeSecurityTeam/EHole | GPL-3.0 |
| nmap | nmap.org | NPS License（含 Npcap 组件的许可见其安装目录） |
| sqlmap | github.com/sqlmapproject/sqlmap | GPLv2（本包分发即源码） |
| jwt_tool | github.com/ticarpi/jwt_tool | GPLv3 |
| JWTCrack | 随包附带脚本与字典，使用说明见工具目录 `使用.txt` | 见目录内说明 |
| capa | github.com/mandiant/capa | Apache-2.0 |
| trivy | github.com/aquasecurity/trivy | Apache-2.0 |
| yara-x | github.com/VirusTotal/yara-x | BSD-3-Clause |
| radare2（随包） | github.com/radareorg/radare2 | LGPL-3.0 |
| binutils（strings/objdump/readelf + 运行库 DLL，随包） | gnu.org（WinLibs Windows 构建） | GPL-3.0（运行库 LGPL） |
| masscan（随包，Windows 源码自编译） | github.com/robertdavidgraham/masscan | MIT |
| wordlists（全量词表合集，随包） | 各来源见 wordlists 内目录名（dirsearch 字典 / SecLists 系等） | 混合许可，仅供授权测试 |
| netexec（git 渠道，PyPI 无包） | github.com/Pennyw0rth/NetExec | BSD-3-Clause |
| impacket（pip 渠道） | github.com/fortra/impacket | Apache-2.0 改造版（原 SSF） |

| kubectl（随包） | dl.k8s.io | Apache-2.0 |
| Google Cloud SDK（随包） | cloud.google.com/sdk | Apache-2.0 |
| aws-cli / azure-cli（随包离线 wheel 集） | pypi.org（awscli / azure-cli 及其依赖） | awscli Apache-2.0 · azure-cli MIT（依赖许可见各 wheel 元数据） |

**不随包分发**（用户自行获取，见 README 获取提示；本机使用版已内置在
  （或经 `PIX_TOOLS_ROOT` 指向的其他位置），PiX 工具卡即自动可用；AI 调用唯一入口为目录内 `rg_batch.py` wrapper。
