import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import uninstall

class WindowsPackageTests(unittest.TestCase):
    def test_gui_handoff_does_not_delete_anything_or_claim_completion(self):
        with tempfile.TemporaryDirectory() as temp:
            package=Path(temp)/'1.16.12/Uninstall.exe';package.parent.mkdir();package.write_bytes(b'fixture')
            with patch.object(uninstall,'windows_package',return_value=package),patch.object(uninstall,'remove_user') as remove,patch.object(uninstall.subprocess,'Popen') as spawn:
                reply=uninstall.run()
            self.assertTrue(reply['pending']);self.assertNotIn('freedMb',reply);remove.assert_not_called()
            self.assertEqual(spawn.call_args.args[0],[str(package)]);self.assertTrue(package.exists())

    def test_package_callback_never_launches_itself_again_and_busy_preserves_files(self):
        with patch.object(uninstall,'windows_package',return_value=Path('/fixture/Uninstall.exe')),patch.object(uninstall,'busy',return_value=True),patch.object(uninstall,'remove_user') as remove,patch.object(uninstall.subprocess,'Popen') as spawn:
            self.assertFalse(uninstall.run(from_package=True)['ok'])
        spawn.assert_not_called();remove.assert_not_called()

    def test_registry_commands_outside_the_owned_version_directory_are_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);exe=root/'QiaomuClipper/1.16.12/Uninstall.exe';exe.parent.mkdir(parents=True);exe.write_bytes(b'fixture')
            registry=Mock();key=Mock();registry.OpenKey.return_value.__enter__=Mock(return_value=key);registry.OpenKey.return_value.__exit__=Mock(return_value=False)
            with patch.object(uninstall.sys,'platform','win32'),patch.dict(os.environ,{'LOCALAPPDATA':str(root)}),patch.dict('sys.modules',{'winreg':registry}):
                registry.QueryValueEx.return_value=(f'"{exe}"',1);self.assertEqual(uninstall.windows_package(),exe.resolve())
                for command in [f'"{exe}" /S',f'"{root}/other.exe"','anything & calc.exe']:
                    registry.QueryValueEx.return_value=(command,1);self.assertIsNone(uninstall.windows_package())

    def test_upgrade_rebases_only_environments_using_the_retired_runtime(self):
        script=Path(__file__).resolve().parents[1]/'scripts/windows/installer.py'
        spec=importlib.util.spec_from_file_location('windows_installer_test',script);installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);previous=root/'1.16.11/Uninstall.exe';native=root/'1.16.12/native';base=root/'user'
            for name,home in [('base',previous.parent/'runtime'),('external',root/'different-python')]:
                env=base/'tools'/name;env.mkdir(parents=True);(env/'pyvenv.cfg').write_text(f'home = {home}\nversion = 3.12.16\n')
            with patch.object(installer.subprocess,'run') as run:installer.rebase_environments(previous,native,base)
            self.assertEqual(run.call_count,2)
            self.assertIn('--upgrade',run.call_args_list[0].args[0]);self.assertIn('--without-pip',run.call_args_list[0].args[0])
            self.assertEqual(run.call_args_list[0].args[0][-1],str(base/'tools/base'))

if __name__=='__main__':unittest.main()
