# -*- coding: utf-8 -*-
"""Standalone PHASE1–3 netlists. No Ethernet Setup GUI / ParametersData callbacks."""
from __future__ import annotations

import re
from pathlib import Path

from .config import bitrate_string, eye_datarate, baud
from .waveforms import pwl_expr


def _posix(p: Path) -> str:
    return p.resolve().as_posix()


def ami_paths(cfg: dict) -> dict[str, Path]:
    ami = cfg["ami"]
    tx_dir = Path(ami["tx_dir"])
    rx_dir = Path(ami["rx_dir"])
    return {
        "tx_dir": tx_dir,
        "rx_dir": rx_dir,
        "tx_ibs": tx_dir / ami["tx_ibs"],
        "rx_ibs": rx_dir / ami["rx_ibs"],
        "tx_s4p": tx_dir / ami["passthrough_s4p"],
        "rx_s4p": rx_dir / ami["passthrough_s4p"],
    }


def tx_ami_line(cfg: dict, *, mode: int, symbol_file: Path, measured: dict | None = None) -> str:
    """my_Ethernet Tx AMI. Mode=1 for GetWave source; Mode=5 for measured handoff."""
    p = ami_paths(cfg)
    p1 = cfg["phase1"]
    rate = bitrate_string(cfg)
    extras = ""
    if measured:
        extras += f' MeasuredWaveformFileName="{measured["file"]}"'
        if measured.get("second"):
            extras += f' SecondMeasuredWaveformFileName="{measured["second"]}"'
        extras += f' NumberOfUIToDiscardInMeasuredWaveform={int(measured.get("discard", 64))}'
        extras += (
            " MaxDeconvolveImpulseLength=25 MaxDeconvolveImpulsePrecursorLength=5"
            f' MaxWaveformLengthUsedInDeconvolve={int(measured.get("max_deconv", 4096))}'
        )
    return (
        f'TX:Ethernet_Host1_Link0_U1_FWD0_AMI N__7 N__6 Model="AMITx" BufferType="Ethernet_F" '
        f'IbisFile="{_posix(p["tx_ibs"])}" ComponentName="my_Ethernet_Tx" PinName="1p" '
        f'InvPinName="1n" ModelName="my_Ethernet_Tx" SetAllData=yes DataTypeSelector=1 UsePkg=yes '
        f'InterpMode="linear" DisableRampWaveformSolution=yes AsyncClkPpm=0.0 '
        f'UseControllerSampleRate=yes BitRate={rate} Encoder=0 Mode={mode} '
        f'PAMSymbolFile="{_posix(symbol_file)}" Taps="10110110111011001" Seed="10110101000101110" '
        f'BitSequence="10101010" RegisterLength=25 '
        f'AMIvarName[1]="AMI_Version" AMIvarName[2]="Init_Returns_Impulse" '
        f'AMIvarName[3]="GetWave_Exists" AMIvarName[4]="Max_Init_Aggressors" '
        f'AMIvarName[5]="Ignore_Bits" AMIvarName[6]="Tx_DCD" AMIvarName[7]="Tx_Rj" '
        f'AMIvarName[8]="Tx_Dj" AMIvarName[9]="Tx_Sj" AMIvarName[10]="Tx_Sj_Frequency" '
        f'AMIvarName[11]="Modulation" AMIvarName[12]="PAM4_Mapping" AMIvarName[13]="Ts4file" '
        f'AMIvarName[14]="Tx_V" AMIvarName[15]="Tx_R" '
        f'AMIvarValue[1]="7.2" AMIvarValue[2]=yes AMIvarValue[3]=yes '
        f'AMIvarValue[4]=2147483646 AMIvarValue[5]={int(p1["tx_ignore_bits"])} '
        f'AMIvarValue[6]=0 AMIvarValue[7]=0 AMIvarValue[8]=0 AMIvarValue[9]=0 '
        f'AMIvarValue[10]=0 AMIvarValue[11]="PAM4" AMIvarValue[12]="0132" '
        f'AMIvarValue[13]="passthrough.s4p" AMIvarValue[14]=1.0 AMIvarValue[15]=50.0'
        f"{extras} "
        f'JitterName[1]="Tx_Dj" JitterValue[1]=0 JitterType[1]="UI" '
        f'JitterName[2]="Tx_Rj" JitterValue[2]=0 JitterType[2]="UI" '
        f'JitterName[3]="Tx_Sj" JitterValue[3]=0 JitterType[3]="UI" '
        f'JitterName[4]="Tx_Sj_Frequency" JitterValue[4]=0 JitterType[4]="Float" PAMFlavor=0'
    )


def rx_ami_line(cfg: dict, nodes: str = "N__2 N__1 N__2_DQRxOut") -> str:
    p = ami_paths(cfg)
    p1 = cfg["phase1"]
    return (
        f'RX:Ethernet_Module1_Link0_U2_FWD0_AMI {nodes} Model="AMIRx" '
        f'IbisFile="{_posix(p["rx_ibs"])}" ComponentName="my_Ethernet_Rx" PinName="2p" '
        f'InvPinName="2n" ModelName="my_Ethernet_Rx" SetAllData=yes DataTypeSelector=1 UsePkg=yes '
        f'InterpMode="linear" DisableRampWaveformSolution=yes AsyncClkPpm=0.0 '
        f'UseControllerSampleRate=yes '
        f'AMIvarName[1]="AMI_Version" AMIvarName[2]="Init_Returns_Impulse" '
        f'AMIvarName[3]="GetWave_Exists" AMIvarName[4]="Max_Init_Aggressors" '
        f'AMIvarName[5]="Ignore_Bits" AMIvarName[6]="Rx_DCD" AMIvarName[7]="Rx_Dj" '
        f'AMIvarName[8]="Rx_Rj" AMIvarName[9]="Rx_Noise" AMIvarName[10]="Rx_Receiver_Sensitivity" '
        f'AMIvarName[11]="Modulation" AMIvarName[12]="PAM4_UpperThreshold" '
        f'AMIvarName[13]="PAM4_LowerThreshold" AMIvarName[14]="PAM4_CenterThreshold" '
        f'AMIvarName[16]="DLL_Path" AMIvarName[17]="Ts4file" AMIvarName[18]="Rx_R" '
        f'AMIvarName[19]="CDR_Mode" AMIvarName[20]="CDR_PhaseDetector" AMIvarName[21]="CDR_MMPD_Vref" '
        f'AMIvarValue[1]="7.2" AMIvarValue[2]=yes AMIvarValue[3]=yes '
        f'AMIvarValue[4]=2147483646 AMIvarValue[5]={int(p1["rx_ignore_bits"])} '
        f'AMIvarValue[6]=0 AMIvarValue[7]=0 AMIvarValue[8]=0 AMIvarValue[9]=0 AMIvarValue[10]=0 '
        f'AMIvarValue[11]="PAM4" AMIvarValue[12]=0.333 AMIvarValue[13]=-0.333 AMIvarValue[14]=0 '
        f'AMIvarValue[16]="./" AMIvarValue[17]="passthrough.s4p" AMIvarValue[18]=50.0 '
        f'AMIvarValue[19]="CDR_Predefined" AMIvarValue[20]="Linear" AMIvarValue[21]=0.45 '
        f'JitterName[1]="Rx_Dj" JitterValue[1]=0 JitterType[1]="UI" '
        f'JitterName[2]="Rx_Rj" JitterValue[2]=0 JitterType[2]="UI" '
        f'JitterName[3]="Rx_Sj" JitterValue[3]=0 JitterType[3]="UI" '
        f'JitterName[4]="Rx_DCD" JitterValue[4]=0 JitterType[4]="UI" '
        f'JitterName[5]="Rx_Noise" JitterValue[5]=0 JitterType[5]="Float"'
    )


def build_phase1_net(cfg: dict, symbol_file: Path) -> str:
    p = ami_paths(cfg)
    p1 = cfg["phase1"]
    n_bits = int(p1["n_bits"])
    block = int(p1["block_size"])
    pts = int(p1["pts_per_ui"])
    mode = int(p1["tx_mode"])
    tx_s4p, rx_s4p = _posix(p["tx_s4p"]), _posix(p["rx_s4p"])
    eye_dr = eye_datarate(cfg)
    tx = tx_ami_line(cfg, mode=mode, symbol_file=symbol_file)
    rx = rx_ami_line(cfg, nodes="N__2 N__1 N__2_DQRxOut")
    return f'''Options ResourceUsage=yes UseNutmegFormat=no TopDesignName="wb_phase1_tx_ami"

ChannelSim:CS1 Type="FastConvolution" NumberOfBits={n_bits} BlockSize={block} \
 ToleranceMode=1 EnforcePassivity=yes MaxImpulseLength=100 NumberTimePtPerUI={pts} StatusLevel=4 \
 AntiAliasingWindow=1 ImpSkipMaxDb=-20 ImpLFEOn=no ImpCache=no

{tx}

R:Ethernet_Host1_Link0_U1_FWD0__TX_R_0 0 N__7_Ethernet_Host1_Link0_U1_FWD0_internal R=50.0 Ohm Noise=yes
R:Ethernet_Host1_Link0_U1_FWD0__TX_R_1 0 N__6_Ethernet_Host1_Link0_U1_FWD0_internal R=50.0 Ohm Noise=yes
SnP:Ethernet_Host1_Link0_U1_FWD0_TX_Ts4File N__7_Ethernet_Host1_Link0_U1_FWD0_internal N__7 N__6_Ethernet_Host1_Link0_U1_FWD0_internal N__6 NumPorts=4 File="{tx_s4p}"
SnP:ChanThru N__7 N__2 N__6 N__1 NumPorts=4 File="{tx_s4p}"
SnP:Ethernet_Module1_Link0_U2_FWD0_RX_Ts4File N__2 N__2_Ethernet_Module1_Link0_U2_FWD0_internal N__1 N__1_Ethernet_Module1_Link0_U2_FWD0_internal NumPorts=4 File="{rx_s4p}"

{rx}

#load "python", "TDM_Eye"
ComponentWithNodes:Eye_P N__2 Type="ModelExtractor" Module="Eye" Save_Waveform=yes DataRate={eye_dr} \
 LowerBoundary=40 UpperThreshold=80 LowerThreshold=20 UpperBoundary=60 TimePoints=200 AmplitudeResolution=0.001 \
 BERWidthHeight=1e-12 UseEyeMask=no ExtrapolateBER=no DisableTransientOutput=yes
#load "python", "TDM_Eye"
ComponentWithNodes:Eye_N N__1 Type="ModelExtractor" Module="Eye" Save_Waveform=yes DataRate={eye_dr} \
 LowerBoundary=40 UpperThreshold=80 LowerThreshold=20 UpperBoundary=60 TimePoints=200 AmplitudeResolution=0.001 \
 BERWidthHeight=1e-12 UseEyeMask=no ExtrapolateBER=no DisableTransientOutput=yes
'''


def build_bridge_net(dec, t_stop: float, ui: float) -> str:
    expr = pwl_expr(dec)
    return f'''Options ResourceUsage=yes UseNutmegFormat=no TopDesignName="wb_tx_bridge"
V_Source:VIN n_drv 0 Type="V_PWL" V_Tran={expr} SaveCurrent=1
R:Rload n_drv 0 R=50 Ohm
Tran:Tran1 StopTime={t_stop} MaxTimeStep={ui/8} StatusLevel=2
'''


def load_envelope_template(cfg: dict, workbench_root: Path) -> str:
    rel = cfg["phase2"].get("envelope_template") or "templates/sipho_envelope_phase2.net"
    path = Path(rel)
    if not path.is_file():
        path = workbench_root / rel
    if not path.is_file():
        raise FileNotFoundError(f"PHASE2 envelope template missing: {path}")
    return path.read_text(encoding="utf-8", errors="replace")


def build_phase2_net(
    cfg: dict,
    workbench_root: Path,
    *,
    bridge_ds: Path,
    t_stop: float,
    n_ui: int,
) -> str:
    net = load_envelope_template(cfg, workbench_root)
    b = baud(cfg)
    net = re.sub(r"(?m)^baud=.*", f"baud={b}", net)
    net = re.sub(r"(?m)^n_ui=\d+", f"n_ui={n_ui}", net)
    net = re.sub(
        r'(?m)^TopDesignName="[^"]*"',
        'TopDesignName="sipho_eoe_workbench:PHASE2_optics:netlist"',
        net,
    )
    # Keep DataRate=baud if present; rewrite any leftover hardcoded rates
    net = net.replace("DataRate=20e9 bps", "DataRate=baud bps")
    net = net.replace("DataRate=53e9 bps", "DataRate=baud bps")
    ds = _posix(bridge_ds)
    vtd = (
        f'VtDataset:SRC_TXAMI N_pam 0 Dataset="{ds}" Expression="n_drv" '
        f'Tmax={t_stop} Freq=0 GHz Gain=1.0 Vdc=0 V Interpolation="linear" '
        f"SaveCurrent=1 IsEOE=1\n"
    )
    if re.search(r"(?m)^VtDataset:SRC_TXAMI", net):
        net = re.sub(r"(?m)^VtDataset:SRC_TXAMI[^\n]*\n", vtd, net)
    elif re.search(r"(?m)^PAM4_source:", net):
        net = re.sub(
            r'(?m)^PAM4_source:[^\n]*\n(?:#uselib[^\n]*PAM4_source[^\n]*\n)?',
            '#uselib "ckt", "VtDataset"\n' + vtd,
            net,
        )
    else:
        raise ValueError("envelope template has neither VtDataset:SRC_TXAMI nor PAM4_source")
    header = (
        f"; SIPHO EOE WORKBENCH PHASE2 baud={b} n_ui={n_ui} Tmax={t_stop}\n"
        f"; Proven handoff: Tx AMI eye -> PWL/Tran -> VtDataset -> Envelope\n"
        f"; NOT official Mode=5 BatchSim; sample my_Ethernet PAM4 AMI\n"
    )
    if not net.lstrip().startswith("; SIPHO EOE WORKBENCH"):
        net = header + net
    return net


def build_phase3_net(
    cfg: dict,
    *,
    symbol_file: Path,
    measured_csv: Path,
    second_csv: Path | None,
) -> str:
    p = ami_paths(cfg)
    p3 = cfg["phase3"]
    n_bits = int(p3["n_bits"])
    discard = int(p3["discard_ui"])
    pts = int(p3.get("pts_per_ui") or cfg["phase1"]["pts_per_ui"])
    meas = {
        "file": _posix(measured_csv),
        "discard": discard,
        "max_deconv": max(n_bits, int(p3["n_ui_min"])),
    }
    if second_csv is not None:
        meas["second"] = _posix(second_csv)
    # Mode=5 measured-waveform Tx (IBIS AMI Tx_Diff used as Mode=5 carrier in proven path)
    # Keep the proven Mode=5 TxWF + my_Ethernet Rx combination.
    tx_s4p, rx_s4p = _posix(p["tx_s4p"]), _posix(p["rx_s4p"])
    rate = bitrate_string(cfg)
    eye_dr = eye_datarate(cfg)
    sec_attr = f' SecondMeasuredWaveformFileName="{meas["second"]}"' if "second" in meas else ""
    # Proven PATH used Keysight Tx_Diff_EQ Mode=5 as the measured-waveform injector
    # (not my_Ethernet Tx in Mode=5). Keep that exact pattern.
    ibis_tx_diff = Path(cfg.get("hpeesof_dir") or r"C:\Program Files\Keysight\ADS2027") / (
        "lib/ibis_ami/Tx_Diff_EQ_Modulation_Levels.ibs"
    )
    rx = rx_ami_line(cfg, nodes="N__2i N__1i N__dq")
    return f'''Options ResourceUsage=yes UseNutmegFormat=no TopDesignName="wb_phase3_rx_ami"

ChannelSim:CS1 Type="FastConvolution" NumberOfBits={n_bits} BlockSize=256 ToleranceMode=1 EnforcePassivity=yes MaxImpulseLength=100 NumberTimePtPerUI={pts} StatusLevel=4 AntiAliasingWindow=1 ImpSkipMaxDb=-20 ImpLFEOn=no ImpCache=no

TX:TxWF N__7 N__6 Model="AMITx" IbisFile="{_posix(ibis_tx_diff)}" ComponentName="Tx_Diff_EQ" PinName="1p" InvPinName="1n" ModelName="Tx_Diff_EQ" SetAllData=yes DataTypeSelector=1 UsePkg=yes IgnoreWaveforms=no DisableRampWaveformSolution=yes InterpMode="linear" Mode=5 BitRate={rate} MeasuredWaveformFileName="{meas["file"]}"{sec_attr} PAMSymbolFile="{_posix(symbol_file)}" NumberOfUIToDiscardInMeasuredWaveform={discard} Encoder=0 UseControllerSampleRate=yes MaxDeconvolveImpulseLength=25 MaxDeconvolveImpulsePrecursorLength=5 MaxWaveformLengthUsedInDeconvolve={meas["max_deconv"]} AMIvarName[1]="AMI_Version" AMIvarName[2]="Init_Returns_Impulse" AMIvarName[3]="GetWave_Exists" AMIvarName[4]="Max_Init_Aggressors" AMIvarName[5]="Modulation_Levels" AMIvarName[6]="Tx_V" AMIvarName[7]="Tx_RFT" AMIvarName[8]="Tx_R" AMIvarName[9]="Tstonefile" AMIvarName[10]="ChooseEQMethod" AMIvarName[11]="Taps" AMIvarName[12]="Preshoot_Deemphasis" AMIvarName[13]="TapInterval" AMIvarValue[1]="5.1" AMIvarValue[2]=yes AMIvarValue[3]=no AMIvarValue[4]=2147483646 AMIvarValue[5]=4 AMIvarValue[6]=1.0 AMIvarValue[7]=10e-12 AMIvarValue[8]=0.0 AMIvarValue[9]="none" AMIvarValue[10]="FIR taps" AMIvarValue[11]="0 1 0" AMIvarValue[12]="0.0 0.0" AMIvarValue[13]=1.0

R:TX_R0 0 N__7i R=50.0 Ohm Noise=yes
R:TX_R1 0 N__6i R=50.0 Ohm Noise=yes
SnP:TX_Ts4 N__7i N__7 N__6i N__6 NumPorts=4 File="{tx_s4p}"
SnP:ChanThru N__7 N__2 N__6 N__1 NumPorts=4 File="{tx_s4p}"
SnP:RX_Ts4 N__2 N__2i N__1 N__1i NumPorts=4 File="{rx_s4p}"

{rx}

#load "python", "TDM_Eye"
ComponentWithNodes:Eye_Rx N__dq Type="ModelExtractor" Module="Eye" Save_Waveform=yes DataRate={eye_dr} \
 LowerBoundary=40 UpperThreshold=80 LowerThreshold=20 UpperBoundary=60 TimePoints=200 AmplitudeResolution=0.001 \
 BERWidthHeight=1e-12 UseEyeMask=no ExtrapolateBER=no DisableTransientOutput=yes
'''
