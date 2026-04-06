<?php

/**
 * @file
 * Post-update hooks for study_taxonomy_owner.
 */

/**
 * Populate field_owner on existing area and subject taxonomy terms.
 *
 * Assigns ownership to the site admin (uid 1) for any terms that pre-date
 * the field_owner field. Run via: drush updatedb / drush updb.
 */
function study_taxonomy_owner_post_update_populate_field_owner(): void {
  $storage = \Drupal::entityTypeManager()->getStorage('taxonomy_term');
  $terms = $storage->loadByProperties([
    'vid' => ['area', 'subject'],
  ]);

  foreach ($terms as $term) {
    if ($term->hasField('field_owner') && $term->get('field_owner')->isEmpty()) {
      $term->set('field_owner', 1);
      $term->save();
    }
  }
}
