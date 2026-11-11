"""Regression coverage for the generated Capacitor notification bridge wiring."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
SPIKE = REPO / "capacitor-spike"


def test_android_notification_setup_installs_and_reinstalls(tmp_path: Path) -> None:
    android = tmp_path / "android"
    main = android / "app/src/main/java/example/sorted/MainActivity.java"
    main.parent.mkdir(parents=True)
    main.write_text(
        "package example.sorted;\n\n"
        "import com.getcapacitor.BridgeActivity;\n\n"
        "public class MainActivity extends BridgeActivity {\n"
        "    @Override\n    public void onCreate(Bundle state) {\n"
        "        super.onCreate(state);\n    }\n}\n"
    )
    script = SPIKE / "scripts/setup-android-notifications.sh"
    environment = {**os.environ, "ANDROID_DIR": str(android)}
    subprocess.run(["bash", str(script)], check=True, env=environment)
    subprocess.run(["bash", str(script)], check=True, env=environment)

    installed = main.parent / "SortedNotificationsPlugin.java"
    assert installed.exists()
    assert installed.read_text().startswith("package example.sorted;")
    contents = main.read_text()
    assert contents.count("registerPlugin(SortedNotificationsPlugin.class)") == 1
    assert contents.index("registerPlugin(SortedNotificationsPlugin.class)") < contents.index("super.onCreate")


def test_android_notification_setup_adds_oncreate_to_capacitor8_blank_activity(tmp_path: Path) -> None:
    android = tmp_path / "android"
    main = android / "app/src/main/java/example/sorted/MainActivity.java"
    main.parent.mkdir(parents=True)
    main.write_text(
        "package example.sorted;\n\n"
        "import com.getcapacitor.BridgeActivity;\n\n"
        "public class MainActivity extends BridgeActivity {}\n"
    )
    script = SPIKE / "scripts/setup-android-notifications.sh"
    environment = {**os.environ, "ANDROID_DIR": str(android)}
    subprocess.run(["bash", str(script)], check=True, env=environment)
    subprocess.run(["bash", str(script)], check=True, env=environment)

    contents = main.read_text()
    assert contents.count("import android.os.Bundle;") == 1
    assert contents.count("void onCreate(") == 1
    assert contents.count("registerPlugin(SortedNotificationsPlugin.class)") == 1
    assert contents.index("registerPlugin(SortedNotificationsPlugin.class)") < contents.index("super.onCreate")


def test_ios_notification_setup_wires_sources_and_registers_on_reinstall(tmp_path: Path) -> None:
    ios = tmp_path / "ios"
    app = ios / "App/App"
    project = ios / "App/App.xcodeproj/project.pbxproj"
    storyboard = app / "Base.lproj/Main.storyboard"
    project.parent.mkdir(parents=True)
    storyboard.parent.mkdir(parents=True)
    # This follows Capacitor 8.5.3's bundled ios-spm-template.tar.gz shape:
    # section markers, an App group with existing children, and a Sources
    # phase with buildActionMask/runOnlyForDeploymentPostprocessing fields.
    project.write_text(
        "// !$*UTF8*$!\n{\n\tobjects = {\n\n"
        "/* Begin PBXBuildFile section */\n"
        "\t\tAAAABBBBCCCCDDDDEEEE0001 /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = AAAABBBBCCCCDDDDEEEE0002 /* AppDelegate.swift */; };\n"
        "/* End PBXBuildFile section */\n\n"
        "/* Begin PBXFileReference section */\n"
        "\t\tAAAABBBBCCCCDDDDEEEE0002 /* AppDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = AppDelegate.swift; sourceTree = \"<group>\"; };\n"
        "/* End PBXFileReference section */\n\n"
        "/* Begin PBXGroup section */\n"
        "\t\tAAAABBBBCCCCDDDDEEEE0005 /* Root */ = {\n"
        "\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n"
        "\t\t\t\tAAAABBBBCCCCDDDDEEEE0003 /* App */,\n"
        "\t\t\t\tAAAABBBBCCCCDDDDEEEE0006 /* Products */,\n"
        "\t\t\t);\n\t\t\tsourceTree = \"<group>\";\n\t\t};\n"
        "\t\tAAAABBBBCCCCDDDDEEEE0006 /* Products */ = {\n"
        "\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n"
        "\t\t\t);\n\t\t\tname = Products;\n\t\t\tsourceTree = \"<group>\";\n\t\t};\n"
        "\t\tAAAABBBBCCCCDDDDEEEE0003 /* App */ = {\n"
        "\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n"
        "\t\t\t\tAAAABBBBCCCCDDDDEEEE0002 /* AppDelegate.swift */,\n"
        "\t\t\t);\n\t\t\tpath = App;\n\t\t\tsourceTree = \"<group>\";\n\t\t};\n"
        "/* End PBXGroup section */\n\n"
        "/* Begin PBXSourcesBuildPhase section */\n"
        "\t\tAAAABBBBCCCCDDDDEEEE0004 /* Sources */ = {\n"
        "\t\t\tisa = PBXSourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n"
        "\t\t\t\tAAAABBBBCCCCDDDDEEEE0001 /* AppDelegate.swift in Sources */,\n"
        "\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n"
        "/* End PBXSourcesBuildPhase section */\n\t};\n}\n"
    )
    storyboard.write_text(
        '<viewController id="BYZ-38-t0r" customClass="CAPBridgeViewController" '
        'customModule="Capacitor" sceneMemberID="viewController"/>\n'
    )
    script = SPIKE / "scripts/setup-ios-notifications.sh"
    environment = {**os.environ, "IOS_DIR": str(ios)}
    subprocess.run(["bash", str(script)], check=True, env=environment)
    subprocess.run(["bash", str(script)], check=True, env=environment)

    contents = project.read_text()
    assert (app / "SortedNotificationsPlugin.swift").exists()
    file_references = re.findall(
        r"([A-F0-9]{24}) /\* SortedNotificationsPlugin\.swift \*/ = \{isa = PBXFileReference;",
        contents,
    )
    assert len(file_references) == 1
    file_id = file_references[0]
    build_files = re.findall(
        rf"([A-F0-9]{{24}}) /\* SortedNotificationsPlugin\.swift in Sources \*/ = \{{isa = PBXBuildFile; fileRef = {file_id} /\* SortedNotificationsPlugin\.swift \*/;",
        contents,
    )
    assert len(build_files) == 1
    build_id = build_files[0]
    app_group = re.search(
        r"isa = PBXGroup;[^}]*?children = \(([^}]*?)\);[^}]*?path = App;",
        contents,
        re.DOTALL,
    )
    assert app_group is not None
    assert app_group.group(1).count(f"{file_id} /* SortedNotificationsPlugin.swift */,") == 1
    root_group = re.search(r"/\* Root \*/ = \{([^}]+)\};", contents)
    assert root_group is not None and file_id not in root_group.group(1)
    source_phase = re.search(
        r"isa = PBXSourcesBuildPhase;[^}]*?files = \(([^}]*?)\);",
        contents,
        re.DOTALL,
    )
    assert source_phase is not None
    assert source_phase.group(1).count(f"{build_id} /* SortedNotificationsPlugin.swift in Sources */,") == 1
    storyboard_contents = storyboard.read_text()
    assert storyboard_contents.count('customClass="SortedBridgeViewController"') == 1
    assert storyboard_contents.count('customModule="App"') == 1
    assert storyboard_contents.count('customModuleProvider="target"') == 1
    assert 'customModule="Capacitor"' not in storyboard_contents


def test_android_plugin_uses_capacitor8_plugin_method_annotation() -> None:
    source = (SPIKE / "native-notifications/android/SortedNotificationsPlugin.java").read_text()
    assert "import com.getcapacitor.PluginMethod;" in source
    assert "import com.getcapacitor.annotation.PluginMethod;" not in source


def test_codemagic_uses_shared_ios_setup_for_uat_and_production() -> None:
    codemagic = (REPO / "codemagic.yaml").read_text()
    assert 'bash scripts/setup-ios-notifications.sh' in codemagic
    # The UAT workflow executes this anchored step directly; production reuses
    # the same anchor, so source wiring cannot drift between iOS artefacts.
    assert "&step_ios_privacy_patch" in codemagic
    assert "*step_ios_privacy_patch" in codemagic
