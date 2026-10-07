"""Factech AI — standalone local IMAGE -> 3D service.

Implements the submit/poll contract the main app's LocalProvider expects
(app/services/mesh_service.py), so it plugs in via MODEL_3D_URL with no
app-code changes. Fully local / offline; no paid API.
"""
